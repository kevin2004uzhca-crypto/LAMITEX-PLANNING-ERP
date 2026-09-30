BEGIN;
-- Preserve historical migration; corrected sources no longer duplicate legacy 101.
CREATE OR REPLACE FUNCTION public.import_pilot_101(payload jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  import_key text; import_pk bigint; model_pk bigint; sku_pk bigint; bom_pk bigint;
  header_pk bigint; material_pk bigint; node jsonb; header jsonb; item jsonb; source jsonb;
  issues jsonb; selected_sku jsonb;
BEGIN
  IF NOT public.has_any_role(ARRAY['ADMIN','ENGINEERING']) THEN
    RAISE EXCEPTION 'Solo ADMIN o ENGINEERING pueden importar el piloto.';
  END IF;
  IF payload->>'sap' <> '3C83010' OR payload->>'title' <> 'POCKET BOREAL MEMORY FOAM'
    OR jsonb_array_length(payload->'nodes') <> 10
    OR payload->>'associationConfirmed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'El caso piloto o su confirmación no son válidos.';
  END IF;
  SELECT s->>'sha256' INTO import_key FROM jsonb_array_elements(payload->'sources') s
    WHERE s->>'file' = 'Arbol_estructura_lamitex.xlsx';
  IF import_key IS NULL THEN RAISE EXCEPTION 'Falta huella de la fuente estructural.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lamitex-pilot-' || import_key, 0));
  SELECT id INTO import_pk FROM public.imports WHERE import_type='PILOT_101' AND file_hash=import_key AND status='COMPLETED';
  IF import_pk IS NOT NULL THEN
    SELECT id INTO sku_pk FROM public.product_skus WHERE sap_material_code='3C83010' ORDER BY id LIMIT 1;
    RETURN sku_pk;
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_skus WHERE sap_material_code='3C83010') THEN
    RAISE EXCEPTION 'El SKU ya existe. Reconciliar antes de importar; no se sobrescribirá.';
  END IF;
  IF jsonb_array_length(payload->'sources') <> 4 THEN RAISE EXCEPTION 'Se requieren las cuatro fuentes.'; END IF;
  FOR source IN SELECT * FROM jsonb_array_elements(payload->'sources') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.imports WHERE import_type='SOURCE_ARCHIVE'
      AND file_hash=source->>'sha256' AND file_name=source->>'file' AND status='STAGED') THEN
      RAISE EXCEPTION 'Primero archiva las cuatro fuentes originales desde Importar datos.';
    END IF;
  END LOOP;
  -- Validate the closed pilot identity and the exact source-derived parent structure.
  IF (SELECT count(DISTINCT (n->>'id')::int) FROM jsonb_array_elements(payload->'nodes') n) <> 10
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'nodes') n WHERE (n->>'id')::int NOT BETWEEN 1 AND 10) THEN
    RAISE EXCEPTION 'IDs de componentes inválidos.';
  END IF;
  FOR node IN SELECT * FROM jsonb_array_elements(payload->'nodes') LOOP
    IF (node->>'quantity')::numeric <= 0 OR (node->>'leadTime')::numeric < 0
      OR (node->>'parent')::int IS DISTINCT FROM
        (CASE WHEN (node->>'id')::int <=3 THEN NULL WHEN (node->>'id')::int<=7 THEN 1 ELSE 5 END)
      OR (node->>'declaredLevel')::int IS DISTINCT FROM
        (CASE WHEN (node->>'id')::int <=3 THEN 1 WHEN (node->>'id')::int<=7 THEN 2 ELSE 3 END) THEN
      RAISE EXCEPTION 'La estructura del piloto no coincide con el caso validado.';
    END IF;
  END LOOP;
  INSERT INTO public.imports(import_type,file_name,file_hash,source_system,imported_by,total_rows,valid_rows,warning_rows,error_rows,status,notes)
  VALUES ('PILOT_101','Arbol_estructura_lamitex.xlsx',import_key,'ERP',auth.uid()::text,10,10,10,0,'COMPLETED',
    jsonb_build_object('sources',payload->'sources','notes',payload->'notes','association_confirmed_by',auth.uid(),'association_confirmed_at',now())::text)
  RETURNING id INTO import_pk;
  INSERT INTO public.product_models(catalog_name_original,canonical_name,source_file,source_row)
  VALUES (payload->>'title',payload->>'title','Base_de_datos_modelos_Resorpedic_2025.xlsx',2) RETURNING id INTO model_pk;
  SELECT c INTO selected_sku FROM jsonb_array_elements(payload->'candidates') c WHERE c->>'sap'='3C83010';
  INSERT INTO public.product_skus(product_model_id,commercial_measure,width_cm,length_cm,height_cm,sap_material_code,sap_name_original,
    legacy_colchon_id,reconciliation_status,engineering_bom_status,sap_bom_status,source_file,source_row)
  VALUES(model_pk,payload->'catalog'->0->>'measure',105,190,38,'3C83010',selected_sku->>'name',101,
    'CONFIRMED','REVIEW_REQUIRED','AVAILABLE','Datos_iniciales_lamitex.xlsx',(selected_sku->>'sourceRow')::int) RETURNING id INTO sku_pk;
  INSERT INTO public.engineering_boms(product_sku_id,version,status,description,source_file)
  VALUES(sku_pk,1,'DRAFT','Piloto 101, componentes 1–10. Unidades pendientes de revisión.','Arbol_estructura_lamitex.xlsx') RETURNING id INTO bom_pk;
  FOR node IN SELECT * FROM jsonb_array_elements(payload->'nodes') LOOP
    INSERT INTO public.engineering_bom_nodes(engineering_bom_id,legacy_component_id,component_name_original,parent_legacy_component_id,
      declared_level,calculated_level,quantity,unit,lead_time,sequence_order,validation_status,notes,source_file,source_row)
    VALUES(bom_pk,(node->>'id')::int,node->>'name',(node->>'parent')::int,(node->>'declaredLevel')::int,(node->>'declaredLevel')::int,
      (node->>'quantity')::numeric,'PENDING_REVIEW',(node->>'leadTime')::numeric,(node->>'sequence')::int,'WARNING',
      jsonb_build_object('source_sheet',node->>'sourceSheet','source_record_id',node->'sourceRecordId','quantity_unit_original',null,'lead_time_unit_original',null,'rule','NULL text becomes null; original name and numbers preserved')::text,
      node->>'sourceFile',(node->>'sourceRow')::int);
  END LOOP;
  FOR header IN SELECT * FROM jsonb_array_elements(payload->'sapHeaders') LOOP
    IF (header->>'baseQuantity')::numeric <= 0 THEN RAISE EXCEPTION 'Cantidad base inválida.'; END IF;
    INSERT INTO public.sap_bom_headers(import_id,product_sku_id,center,parent_material_code,alternative,base_quantity,base_unit,parent_description,source_file)
    VALUES(import_pk,sku_pk,header->>'center',header->>'material',header->>'alternative',(header->>'baseQuantity')::numeric,header->>'baseUnit',header->>'description','EXPORT_ListasMateriales3001_3034.xlsx') RETURNING id INTO header_pk;
    FOR item IN SELECT * FROM jsonb_array_elements(header->'items') LOOP
      INSERT INTO public.materials(sap_code,sap_description_original,source_file,source_row)
      VALUES(item->>'code',item->>'name',item->>'sourceFile',(item->>'sourceRow')::int)
      ON CONFLICT(sap_code) DO NOTHING;
      SELECT id INTO material_pk FROM public.materials WHERE sap_code=item->>'code';
      INSERT INTO public.sap_bom_items(sap_bom_header_id,position,component_code,component_description,component_quantity,component_unit,normalized_unit_quantity,material_id,source_row)
      VALUES(header_pk,item->>'position',item->>'code',item->>'name',(item->>'quantity')::numeric,item->>'unit',
        (item->>'quantity')::numeric/(header->>'baseQuantity')::numeric,material_pk,(item->>'sourceRow')::int);
    END LOOP;
  END LOOP;
  INSERT INTO public.validation_issues(entity_type,entity_id,issue_type,severity,message,status)
  VALUES('engineering_bom',bom_pk,'MISSING_UOM','WARNING','La fuente no declara unidades de cantidad ni de lead time. PENDING_REVIEW no representa una unidad física.','OPEN');
  IF jsonb_array_length(payload->'candidates') > 1 THEN
  INSERT INTO public.validation_issues(entity_type,entity_id,issue_type,severity,message,status,reviewed_by,reviewed_at,review_comment)
  VALUES('product_sku',sku_pk,'LEGACY_ID_CONFLICT','WARNING','ID 101 reutilizado en 3C83010 y 3C81021.','RESOLVED',auth.uid()::text,now(),'Asociación de componentes 1–10 al SKU 3C83010 confirmada por el usuario al importar.');
  END IF;
  RETURN sku_pk;
END;
$$;
REVOKE ALL ON FUNCTION public.import_pilot_101(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_pilot_101(jsonb) TO authenticated;
COMMIT;
