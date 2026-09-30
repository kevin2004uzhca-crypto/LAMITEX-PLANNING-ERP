BEGIN;
ALTER TABLE public.materials
 ADD COLUMN material_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN purchase_unit text,
 ADD COLUMN conversion_from_unit text,
 ADD COLUMN units_per_purchase numeric CHECK(units_per_purchase>0),
 ADD COLUMN conversion_confirmed boolean NOT NULL DEFAULT false,
 ADD COLUMN package_content numeric CHECK(package_content>0),
 ADD COLUMN mrp_classification text,
 ADD COLUMN notes text,
 ADD COLUMN updated_by uuid;
CREATE TABLE public.material_units(code text PRIMARY KEY,description text,confirmed boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true);
ALTER TABLE public.material_units ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.material_units TO authenticated;
CREATE POLICY units_read ON public.material_units FOR SELECT TO authenticated USING(public.is_active_user());
CREATE POLICY units_insert ON public.material_units FOR INSERT TO authenticated WITH CHECK(public.has_any_role(ARRAY['ADMIN','ENGINEERING']));
CREATE POLICY units_update ON public.material_units FOR UPDATE TO authenticated USING(public.has_any_role(ARRAY['ADMIN','ENGINEERING'])) WITH CHECK(public.has_any_role(ARRAY['ADMIN','ENGINEERING']));
INSERT INTO public.material_families(family_name,description)
SELECT value,'Catálogo inicial; la familia no altera cantidades ni crea sustituciones.' FROM unnest(ARRAY['TELAS / TEJIDOS','ESPUMAS / FOAMS','LÁTEX','RESORTES','ESTRUCTURAS','GRAPAS','ADHESIVOS / PEGAMENTOS','HILOS','PLÁSTICOS','CINTAS / REATAS','ETIQUETAS','EMPAQUES','CONSUMIBLES','SEMIPRODUCTOS','OTROS']) value
WHERE NOT EXISTS(SELECT 1 FROM public.material_families f WHERE f.family_name=value AND f.subfamily_name IS NULL);
ALTER TABLE public.sap_bom_headers ADD COLUMN active boolean NOT NULL DEFAULT true,
 ADD COLUMN source_sheet text,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.sap_bom_items ADD COLUMN component_alternative text,ADD COLUMN source_sheet text,ADD COLUMN raw_source jsonb;
CREATE INDEX sap_header_material_active ON public.sap_bom_headers(parent_material_code,active);
CREATE INDEX sap_items_code_unit ON public.sap_bom_items(component_code,component_unit);
CREATE TABLE public.sap_import_headers(import_id bigint REFERENCES public.imports(id),header_id bigint REFERENCES public.sap_bom_headers(id),PRIMARY KEY(import_id,header_id));
ALTER TABLE public.sap_import_headers ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.sap_import_headers TO authenticated;
CREATE POLICY sap_imports_read ON public.sap_import_headers FOR SELECT TO authenticated USING(public.is_active_user());
CREATE POLICY sap_imports_insert ON public.sap_import_headers FOR INSERT TO authenticated WITH CHECK(public.has_any_role(ARRAY['ADMIN','ENGINEERING']));
CREATE UNIQUE INDEX sap_completed_hash ON public.imports(file_hash) WHERE import_type='SAP_MATERIALS' AND status='COMPLETED';
CREATE TABLE public.product_sap_link_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,product_sku_id bigint NOT NULL REFERENCES public.product_skus(id),previous_code text,new_code text,source text NOT NULL,created_by uuid NOT NULL DEFAULT auth.uid(),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.product_sap_link_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.product_sap_link_history TO authenticated;
GRANT USAGE ON SEQUENCE public.product_sap_link_history_id_seq TO authenticated;
CREATE POLICY sap_links_read ON public.product_sap_link_history FOR SELECT TO authenticated USING(public.is_active_user());
CREATE POLICY sap_links_insert ON public.product_sap_link_history FOR INSERT TO authenticated WITH CHECK(public.has_any_role(ARRAY['ADMIN','ENGINEERING']) AND created_by=auth.uid());

CREATE FUNCTION public.import_sap_materials(payload jsonb,source_hash text,source_name text,sheet_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE imp bigint; h record; hid bigint; reused int=0; inserted int=0; linked int=0; sig jsonb; candidate record;
BEGIN
 IF NOT public.has_any_role(ARRAY['ADMIN','ENGINEERING']) THEN RAISE EXCEPTION 'Acceso de importación denegado.';END IF;
 IF source_hash !~ '^[0-9a-f]{64}$' OR jsonb_array_length(payload) NOT BETWEEN 1 AND 50000 THEN RAISE EXCEPTION 'Archivo o huella inválidos.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lamitex-sap-import',0));
 SELECT id INTO imp FROM public.imports WHERE import_type='SAP_MATERIALS' AND file_hash=source_hash AND status='COMPLETED';
 IF FOUND THEN RETURN jsonb_build_object('importId',imp,'alreadyImported',true);END IF;
 CREATE TEMP TABLE sap_incoming ON COMMIT DROP AS SELECT x.* FROM jsonb_to_recordset(payload) x(center text,alternative text,material text,description text,base_quantity numeric(18,6),base_unit text,position text,component text,quantity numeric(18,6),unit text,component_alternative text,component_description text,source_row integer,raw_source jsonb);
 CREATE INDEX ON sap_incoming(center,material,alternative);
 CREATE INDEX ON sap_incoming(material);
 ANALYZE sap_incoming;
 IF EXISTS(SELECT 1 FROM sap_incoming WHERE NULLIF(material,'') IS NULL OR NULLIF(center,'') IS NULL OR NULLIF(alternative,'') IS NULL OR NULLIF(component,'') IS NULL OR base_quantity IS NULL OR base_quantity<=0 OR base_quantity::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Código o cantidad base inválidos.';END IF;
 IF EXISTS(SELECT 1 FROM sap_incoming GROUP BY center,material,alternative HAVING count(DISTINCT base_quantity)>1 OR count(DISTINCT COALESCE(base_unit,''))>1) THEN RAISE EXCEPTION 'Bases inconsistentes dentro de una alternativa.';END IF;
 INSERT INTO public.imports(import_type,file_name,file_hash,source_system,imported_by,total_rows,status,notes)
 VALUES('SAP_MATERIALS',source_name,source_hash,'SAP',auth.uid()::text,jsonb_array_length(payload),'PROCESSING','Importación de materiales. Sin modificación de ingeniería.') RETURNING id INTO imp;
 INSERT INTO public.material_units(code) SELECT DISTINCT unit FROM sap_incoming WHERE NULLIF(unit,'') IS NOT NULL ON CONFLICT DO NOTHING;
 INSERT INTO public.material_units(code) SELECT DISTINCT base_unit FROM sap_incoming WHERE NULLIF(base_unit,'') IS NOT NULL ON CONFLICT DO NOTHING;
 INSERT INTO public.materials(sap_code,sap_description_original,source_file,source_row)
 SELECT DISTINCT ON(component) component,component_description,source_name,source_row FROM sap_incoming ORDER BY component,source_row ON CONFLICT(sap_code) DO NOTHING;
 FOR h IN SELECT center,material,alternative,min(description) description,min(base_quantity) base_quantity,min(base_unit) base_unit FROM sap_incoming GROUP BY center,material,alternative LOOP
  SELECT jsonb_agg(jsonb_build_array(i.position,i.component,i.quantity,i.unit,i.component_description,i.source_row) ORDER BY i.source_row) INTO sig FROM sap_incoming i WHERE i.center=h.center AND i.material=h.material AND i.alternative=h.alternative;
  hid=NULL;
  FOR candidate IN SELECT id FROM public.sap_bom_headers b WHERE b.parent_material_code=h.material AND b.center=h.center AND b.alternative=h.alternative AND b.active AND b.base_quantity=h.base_quantity AND b.base_unit IS NOT DISTINCT FROM h.base_unit LOOP
   IF (SELECT jsonb_agg(jsonb_build_array(i.position,i.component_code,i.component_quantity,i.component_unit,i.component_description,i.source_row) ORDER BY i.source_row) FROM public.sap_bom_items i WHERE i.sap_bom_header_id=candidate.id)=sig THEN hid=candidate.id;EXIT;END IF;
  END LOOP;
  IF hid IS NULL THEN
   UPDATE public.sap_bom_headers b SET active=false,updated_at=now() WHERE b.parent_material_code=h.material AND b.center=h.center AND b.alternative=h.alternative AND b.active;
   INSERT INTO public.sap_bom_headers(import_id,center,parent_material_code,alternative,base_quantity,base_unit,parent_description,source_file,source_sheet)
   VALUES(imp,h.center,h.material,h.alternative,h.base_quantity,h.base_unit,h.description,source_name,sheet_name) RETURNING id INTO hid;
   INSERT INTO public.sap_bom_items(sap_bom_header_id,position,component_code,component_description,component_quantity,component_unit,normalized_unit_quantity,material_id,source_row,component_alternative,source_sheet,raw_source)
   SELECT hid,i.position,i.component,i.component_description,i.quantity,i.unit,i.quantity/h.base_quantity,m.id,i.source_row,i.component_alternative,sheet_name,i.raw_source FROM sap_incoming i JOIN public.materials m ON m.sap_code=i.component WHERE i.center=h.center AND i.material=h.material AND i.alternative=h.alternative;
   inserted=inserted+1;
  ELSE
   -- Fill previously absent SAP provenance only; never replace existing quantities or positions.
   UPDATE public.sap_bom_items p SET component_alternative=COALESCE(p.component_alternative,i.component_alternative),source_sheet=COALESCE(p.source_sheet,sheet_name),raw_source=COALESCE(p.raw_source,i.raw_source)
   FROM sap_incoming i WHERE p.sap_bom_header_id=hid AND p.source_row=i.source_row AND i.center=h.center AND i.material=h.material AND i.alternative=h.alternative;
   reused=reused+1;
  END IF;
  INSERT INTO public.sap_import_headers VALUES(imp,hid);
 END LOOP;
 -- Exact reference codes only. Existing nonempty SAP mappings are preserved.
 INSERT INTO public.product_sap_link_history(product_sku_id,previous_code,new_code,source)
 SELECT s.id,s.sap_material_code,m.reference_code,'Coincidencia exacta de código de referencia con material padre SAP' FROM public.product_skus s JOIN public.product_models m ON m.id=s.product_model_id
 WHERE NULLIF(s.sap_material_code,'') IS NULL AND EXISTS(SELECT 1 FROM sap_incoming i WHERE i.material=m.reference_code);
 UPDATE public.product_skus s SET sap_material_code=m.reference_code FROM public.product_models m WHERE m.id=s.product_model_id AND NULLIF(s.sap_material_code,'') IS NULL AND EXISTS(SELECT 1 FROM sap_incoming i WHERE i.material=m.reference_code);
 GET DIAGNOSTICS linked=ROW_COUNT;
 UPDATE public.sap_bom_headers b SET product_sku_id=s.id FROM public.product_skus s WHERE b.product_sku_id IS NULL AND b.parent_material_code=s.sap_material_code AND (SELECT count(*) FROM public.product_skus x WHERE x.sap_material_code=b.parent_material_code)=1;
 INSERT INTO public.validation_issues(entity_type,entity_id,issue_type,severity,message)
 SELECT 'import',imp,'SAP_DESCRIPTION_CONFLICT','WARNING','Código '||component||': varias descripciones originales; no se fusionaron otros códigos.' FROM sap_incoming GROUP BY component HAVING count(DISTINCT component_description)>1;
 UPDATE public.imports SET status='COMPLETED',valid_rows=jsonb_array_length(payload),warning_rows=(SELECT count(*) FROM sap_incoming WHERE quantity<0 OR quantity IS NULL OR NULLIF(unit,'') IS NULL),error_rows=0 WHERE id=imp;
 RETURN jsonb_build_object('importId',imp,'alreadyImported',false,'newHeaders',inserted,'reusedHeaders',reused,'linkedProducts',linked,'rows',jsonb_array_length(payload));
END;$$;
REVOKE ALL ON FUNCTION public.import_sap_materials(jsonb,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_sap_materials(jsonb,text,text,text) TO authenticated;

CREATE FUNCTION public.set_product_sap_link(sku bigint,previous text,new_code text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_code text;
BEGIN
 IF NOT public.has_any_role(ARRAY['ADMIN','ENGINEERING']) THEN RAISE EXCEPTION 'Acceso de edición denegado.';END IF;
 SELECT sap_material_code INTO old_code FROM public.product_skus WHERE id=sku FOR UPDATE;
 IF NOT FOUND OR old_code IS DISTINCT FROM previous THEN RAISE EXCEPTION 'La relación cambió. Actualiza la página.';END IF;
 IF NULLIF(new_code,'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sap_bom_headers WHERE parent_material_code=new_code AND active) THEN RAISE EXCEPTION 'El código no tiene lista SAP activa.';END IF;
 INSERT INTO public.product_sap_link_history(product_sku_id,previous_code,new_code,source) VALUES(sku,old_code,NULLIF(new_code,''),'Selección explícita por código SAP');
 UPDATE public.product_skus SET sap_material_code=NULLIF(new_code,'') WHERE id=sku;
END;$$;
REVOKE ALL ON FUNCTION public.set_product_sap_link(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_product_sap_link(bigint,text,text) TO authenticated;

CREATE TABLE public.mrp_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL DEFAULT auth.uid(),status text NOT NULL,input jsonb NOT NULL,result jsonb NOT NULL);
ALTER TABLE public.mrp_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.mrp_runs TO authenticated;
CREATE POLICY mrp_read ON public.mrp_runs FOR SELECT TO authenticated USING(public.is_active_user());
CREATE POLICY mrp_insert ON public.mrp_runs FOR INSERT TO authenticated WITH CHECK(public.has_any_role(ARRAY['ADMIN','ENGINEERING','PLANNER','SUPERVISOR']) AND created_by=auth.uid());
NOTIFY pgrst,'reload schema';
COMMIT;
