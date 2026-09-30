BEGIN;
CREATE OR REPLACE FUNCTION public.import_sap_materials(payload jsonb,source_hash text,source_name text,sheet_name text) RETURNS jsonb
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
   IF (SELECT jsonb_agg(jsonb_build_array(i.position,i.component_code,i.component_quantity,i.component_unit,i.component_description,i.source_row) ORDER BY i.source_row) FROM public.sap_bom_items i WHERE i.sap_bom_header_id=candidate.id)=sig AND NOT EXISTS(SELECT 1 FROM public.sap_bom_items p JOIN sap_incoming i ON i.source_row=p.source_row WHERE p.sap_bom_header_id=candidate.id AND p.component_alternative IS NOT NULL AND p.component_alternative IS DISTINCT FROM i.component_alternative) THEN hid=candidate.id;EXIT;END IF;
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
ALTER FUNCTION public.import_sap_materials(jsonb,text,text,text) SET statement_timeout='90s';
CREATE UNIQUE INDEX material_family_unique_name ON public.material_families(family_name,COALESCE(subfamily_name,''));
NOTIFY pgrst,'reload schema';
NOTIFY pgrst,'reload config';
COMMIT;
