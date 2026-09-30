BEGIN;
ALTER TABLE public.product_models
 ADD COLUMN reference_code text, ADD COLUMN brand text, ADD COLUMN description text,
 ADD COLUMN image_path text, ADD COLUMN notes text,
 ADD COLUMN created_by uuid, ADD COLUMN updated_by uuid;
ALTER TABLE public.engineering_boms
 ADD COLUMN reference text NOT NULL DEFAULT gen_random_uuid()::text,
 ADD COLUMN lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle IN ('ACTIVE','INACTIVE','ARCHIVED')),
 ADD COLUMN revision integer NOT NULL DEFAULT 1,
 ADD COLUMN source_type text NOT NULL DEFAULT 'LEGACY_IMPORT',
 ADD COLUMN created_by uuid, ADD COLUMN updated_by uuid;
CREATE UNIQUE INDEX engineering_bom_reference_unique ON public.engineering_boms(reference);
ALTER TABLE public.engineering_bom_nodes
 ALTER COLUMN legacy_component_id DROP NOT NULL,
 ALTER COLUMN unit DROP NOT NULL, ALTER COLUMN unit DROP DEFAULT,
 ADD COLUMN node_code text, ADD COLUMN parent_node_code text,
 ADD COLUMN external_component_id text,
 ADD COLUMN active boolean NOT NULL DEFAULT true,
 ADD COLUMN lead_time_unit text,
 ADD COLUMN created_by uuid, ADD COLUMN updated_by uuid;
UPDATE public.engineering_bom_nodes SET node_code='legacy:'||legacy_component_id,
 parent_node_code=CASE WHEN parent_legacy_component_id IS NOT NULL THEN 'legacy:'||parent_legacy_component_id END,
 external_component_id=legacy_component_id::text,
 unit=CASE WHEN unit='PENDING_REVIEW' THEN NULL ELSE unit END;
ALTER TABLE public.engineering_bom_nodes ALTER COLUMN node_code SET NOT NULL;
ALTER TABLE public.engineering_bom_nodes ALTER COLUMN node_code SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.engineering_bom_nodes ADD CONSTRAINT engineering_node_code_unique UNIQUE(engineering_bom_id,node_code);
ALTER TABLE public.engineering_bom_nodes ADD CONSTRAINT engineering_parent_code_fk
 FOREIGN KEY(engineering_bom_id,parent_node_code) REFERENCES public.engineering_bom_nodes(engineering_bom_id,node_code) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.engineering_bom_nodes ADD CONSTRAINT engineering_node_not_self CHECK(parent_node_code IS NULL OR parent_node_code<>node_code);
CREATE UNIQUE INDEX engineering_external_component_unique ON public.engineering_bom_nodes(engineering_bom_id,external_component_id) WHERE external_component_id IS NOT NULL;
CREATE FUNCTION public.engineering_legacy_insert() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.legacy_component_id IS NOT NULL THEN
  NEW.node_code='legacy:'||NEW.legacy_component_id;
  NEW.external_component_id=COALESCE(NEW.external_component_id,NEW.legacy_component_id::text);
  NEW.parent_node_code=CASE WHEN NEW.parent_legacy_component_id IS NOT NULL THEN 'legacy:'||NEW.parent_legacy_component_id END;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER engineering_legacy_insert BEFORE INSERT ON public.engineering_bom_nodes FOR EACH ROW EXECUTE FUNCTION public.engineering_legacy_insert();

CREATE TABLE public.engineering_bom_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 engineering_bom_id bigint NOT NULL REFERENCES public.engineering_boms(id),
 revision integer NOT NULL, actor uuid NOT NULL DEFAULT auth.uid(), recorded_at timestamptz NOT NULL DEFAULT now(),
 snapshot jsonb NOT NULL,
 UNIQUE(engineering_bom_id,revision)
);
ALTER TABLE public.engineering_bom_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.engineering_bom_history TO authenticated;
GRANT USAGE ON SEQUENCE public.engineering_bom_history_id_seq TO authenticated;
CREATE POLICY bom_history_read ON public.engineering_bom_history FOR SELECT TO authenticated USING(public.is_active_user());
CREATE POLICY bom_history_insert ON public.engineering_bom_history FOR INSERT TO authenticated WITH CHECK(public.has_any_role(ARRAY['ADMIN','ENGINEERING']) AND actor=auth.uid());

-- Applied even to direct SQL/API writes; legacy and new nodes stay in the same BOM.
CREATE FUNCTION public.check_engineering_graph() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE bid bigint; bad boolean;
BEGIN
 bid=COALESCE(NEW.engineering_bom_id,OLD.engineering_bom_id);
 IF EXISTS(SELECT 1 FROM public.engineering_bom_nodes n JOIN public.engineering_bom_nodes p
 ON p.engineering_bom_id=n.engineering_bom_id AND p.node_code=n.parent_node_code
 WHERE n.engineering_bom_id=bid AND n.active AND NOT p.active) THEN
 RAISE EXCEPTION 'Un componente activo depende de un padre inactivo.'; END IF;
 WITH RECURSIVE walk AS (
 SELECT node_code,parent_node_code,ARRAY[node_code] AS path,false AS cycle FROM public.engineering_bom_nodes WHERE engineering_bom_id=bid
 UNION ALL SELECT w.node_code,p.parent_node_code,w.path||p.node_code,p.node_code=ANY(w.path)
 FROM walk w JOIN public.engineering_bom_nodes p ON p.engineering_bom_id=bid AND p.node_code=w.parent_node_code WHERE NOT w.cycle
 ) SELECT EXISTS(SELECT 1 FROM walk WHERE cycle) INTO bad;
 IF bad THEN RAISE EXCEPTION 'La estructura contiene ciclos.'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER engineering_graph_valid AFTER INSERT OR UPDATE ON public.engineering_bom_nodes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_engineering_graph();

CREATE FUNCTION public.save_engineering_boms(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b jsonb; n jsonb; bid bigint; mid bigint; sid bigint; oldrev int; newrev int;
 saved jsonb='[]'; codes text[]; count_nodes int; total_nodes int=0; ref text; modeldata jsonb;
BEGIN
 IF NOT public.has_any_role(ARRAY['ADMIN','ENGINEERING']) THEN RAISE EXCEPTION 'Acceso de edición denegado.'; END IF;
 IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Carga inválida: máximo 200 BOM por operación.'; END IF;
 FOR b IN SELECT * FROM jsonb_array_elements(payload) LOOP
  count_nodes=jsonb_array_length(b->'nodes'); total_nodes=total_nodes+count_nodes;
  IF count_nodes NOT BETWEEN 1 AND 2000 OR total_nodes>20000 THEN RAISE EXCEPTION 'Cantidad de componentes fuera del límite de la operación.'; END IF;
  IF NULLIF(trim(b->>'design'),'') IS NULL THEN RAISE EXCEPTION 'Nombre de diseño obligatorio.'; END IF;
  IF b->>'lifecycle' NOT IN ('ACTIVE','INACTIVE','ARCHIVED') THEN RAISE EXCEPTION 'Estado inválido.'; END IF;
  IF b->>'sourceType' NOT IN ('MANUAL','EXCEL_IMPORT','LEGACY_IMPORT') THEN RAISE EXCEPTION 'Fuente inválida.'; END IF;
  IF NULLIF(b->>'imagePath','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='product-images' AND name=b->>'imagePath') THEN RAISE EXCEPTION 'La imagen no existe en Storage.'; END IF;
  SELECT array_agg(v->>'key') INTO codes FROM jsonb_array_elements(b->'nodes') v;
  IF (SELECT count(DISTINCT v) FROM unnest(codes) v)<>count_nodes OR EXISTS(SELECT 1 FROM unnest(codes) v WHERE NULLIF(trim(v),'') IS NULL) THEN RAISE EXCEPTION 'Identificadores duplicados o vacíos.'; END IF;
  FOR n IN SELECT * FROM jsonb_array_elements(b->'nodes') LOOP
   IF NULLIF(trim(n->>'name'),'') IS NULL OR (n->>'quantity')::numeric IS NULL OR (n->>'quantity')::numeric<=0
    OR (n->>'quantity')::numeric::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Componente o cantidad inválida.'; END IF;
   IF (n->>'leadTime')::numeric<0 OR (n->>'leadTime')::numeric::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Lead time inválido.'; END IF;
   IF NULLIF(n->>'parentKey','') IS NOT NULL AND NOT (n->>'parentKey'=ANY(codes)) THEN RAISE EXCEPTION 'Padre inexistente en este BOM.'; END IF;
   IF n->>'parentKey'=n->>'key' THEN RAISE EXCEPTION 'Autorrelación inválida.'; END IF;
  END LOOP;
  bid=NULLIF(b->>'id','')::bigint;
  IF bid IS NULL THEN
   INSERT INTO public.product_models(catalog_name_original,reference_code,brand,description,image_path,notes,created_by,updated_by)
   VALUES(b->>'design',NULLIF(b->>'referenceCode',''),NULLIF(b->>'brand',''),NULLIF(b->>'description',''),NULLIF(b->>'imagePath',''),NULLIF(b->>'notes',''),auth.uid(),auth.uid()) RETURNING id INTO mid;
   INSERT INTO public.product_skus(product_model_id,source_file,reconciliation_status) VALUES(mid,b->>'sourceFile','PENDING_REVIEW') RETURNING id INTO sid;
   INSERT INTO public.engineering_boms(product_sku_id,source_type,lifecycle,source_file,created_by,updated_by)
   VALUES(sid,b->>'sourceType',b->>'lifecycle',NULLIF(b->>'sourceFile',''),auth.uid(),auth.uid()) RETURNING id,revision,reference INTO bid,newrev,ref;
  ELSE
   SELECT eb.revision,eb.product_sku_id,ps.product_model_id,eb.reference INTO oldrev,sid,mid,ref
   FROM public.engineering_boms eb JOIN public.product_skus ps ON ps.id=eb.product_sku_id WHERE eb.id=bid FOR UPDATE OF eb;
   IF NOT FOUND THEN RAISE EXCEPTION 'BOM no encontrado.'; END IF;
   IF oldrev IS DISTINCT FROM (b->>'revision')::int THEN RAISE EXCEPTION 'Otro usuario modificó este BOM. Recarga antes de guardar.'; END IF;
   -- Preserve complete before-state before the first edit, including all legacy fields.
   INSERT INTO public.engineering_bom_history(engineering_bom_id,revision,snapshot)
   SELECT bid,oldrev,jsonb_build_object('bom',to_jsonb(eb),'model',to_jsonb(pm),'nodes',(SELECT jsonb_agg(to_jsonb(x)) FROM public.engineering_bom_nodes x WHERE x.engineering_bom_id=bid))
   FROM public.engineering_boms eb JOIN public.product_models pm ON pm.id=mid WHERE eb.id=bid ON CONFLICT DO NOTHING;
   newrev=oldrev+1;
   UPDATE public.product_models SET catalog_name_original=b->>'design',reference_code=NULLIF(b->>'referenceCode',''),brand=NULLIF(b->>'brand',''),description=NULLIF(b->>'description',''),image_path=NULLIF(b->>'imagePath',''),notes=NULLIF(b->>'notes',''),updated_by=auth.uid() WHERE id=mid;
   UPDATE public.engineering_boms SET revision=newrev,lifecycle=b->>'lifecycle',source_type=b->>'sourceType',source_file=NULLIF(b->>'sourceFile',''),updated_by=auth.uid() WHERE id=bid;
   UPDATE public.engineering_bom_nodes SET active=false,updated_by=auth.uid() WHERE engineering_bom_id=bid AND NOT(node_code=ANY(codes));
  END IF;
  FOR n IN SELECT * FROM jsonb_array_elements(b->'nodes') LOOP
   INSERT INTO public.engineering_bom_nodes(engineering_bom_id,node_code,parent_node_code,external_component_id,component_name_original,declared_level,quantity,unit,lead_time,lead_time_unit,notes,active,sequence_order,source_file,source_row,created_by,updated_by)
   VALUES(bid,n->>'key',NULLIF(n->>'parentKey',''),NULLIF(n->>'externalId',''),n->>'name',(n->>'declaredLevel')::int,(n->>'quantity')::numeric,NULLIF(n->>'unit',''),(n->>'leadTime')::numeric,NULLIF(n->>'leadTimeUnit',''),NULLIF(n->>'notes',''),COALESCE((n->>'active')::boolean,true),(n->>'sequence')::int,NULLIF(n->>'sourceFile',''),(n->>'sourceRow')::int,auth.uid(),auth.uid())
   ON CONFLICT(engineering_bom_id,node_code) DO UPDATE SET parent_node_code=EXCLUDED.parent_node_code,external_component_id=EXCLUDED.external_component_id,component_name_original=EXCLUDED.component_name_original,declared_level=EXCLUDED.declared_level,quantity=EXCLUDED.quantity,unit=EXCLUDED.unit,lead_time=EXCLUDED.lead_time,lead_time_unit=EXCLUDED.lead_time_unit,notes=EXCLUDED.notes,active=EXCLUDED.active,sequence_order=EXCLUDED.sequence_order,updated_by=auth.uid();
  END LOOP;
  UPDATE public.engineering_bom_nodes n SET parent_legacy_component_id=p.legacy_component_id FROM public.engineering_bom_nodes p WHERE n.engineering_bom_id=bid AND p.engineering_bom_id=bid AND p.node_code=n.parent_node_code;
  UPDATE public.engineering_bom_nodes SET parent_legacy_component_id=NULL WHERE engineering_bom_id=bid AND parent_node_code IS NULL;
  WITH RECURSIVE levels AS (
   SELECT node_code,1 AS depth FROM public.engineering_bom_nodes WHERE engineering_bom_id=bid AND parent_node_code IS NULL
   UNION ALL SELECT n.node_code,l.depth+1 FROM levels l JOIN public.engineering_bom_nodes n ON n.engineering_bom_id=bid AND n.parent_node_code=l.node_code
  ) UPDATE public.engineering_bom_nodes n SET calculated_level=l.depth,validation_status=CASE WHEN n.declared_level IS DISTINCT FROM l.depth OR n.unit IS NULL OR n.lead_time IS NULL THEN 'WARNING' ELSE 'VALID' END FROM levels l WHERE n.engineering_bom_id=bid AND n.node_code=l.node_code;
  -- Forces graph constraints now, before recording a successful snapshot.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO public.engineering_bom_history(engineering_bom_id,revision,snapshot)
  SELECT bid,newrev,jsonb_build_object('bom',to_jsonb(eb),'model',to_jsonb(pm),'nodes',(SELECT jsonb_agg(to_jsonb(x)) FROM public.engineering_bom_nodes x WHERE x.engineering_bom_id=bid)) FROM public.engineering_boms eb JOIN public.product_models pm ON pm.id=mid WHERE eb.id=bid;
  saved=saved||jsonb_build_array(jsonb_build_object('id',bid,'revision',newrev,'reference',ref));
 END LOOP;
 RETURN saved;
END; $$;
REVOKE ALL ON FUNCTION public.save_engineering_boms(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_engineering_boms(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
