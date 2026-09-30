SELECT jsonb_build_object(
 'counts',jsonb_build_object('models',(SELECT count(*) FROM product_models),'skus',(SELECT count(*) FROM product_skus),'engineeringBoms',(SELECT count(*) FROM engineering_boms),'engineeringNodes',(SELECT count(*) FROM engineering_bom_nodes),'sapHeaders',(SELECT count(*) FROM sap_bom_headers WHERE active),'sapItems',(SELECT count(*) FROM sap_bom_items i JOIN sap_bom_headers h ON h.id=i.sap_bom_header_id WHERE h.active),'materials',(SELECT count(*) FROM materials)),
 'modelsHash',(SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM product_models m),
 'engineeringBomsHash',(SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM engineering_boms m),
 'engineeringNodesHash',(SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM engineering_bom_nodes m),
 'sapImport',(SELECT to_jsonb(i) FROM imports i WHERE import_type='SAP_MATERIALS' ORDER BY id DESC LIMIT 1),
 'checks',public.sap_catalog_checks(),
 'rls',(SELECT jsonb_object_agg(relname,relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('materials','material_families','material_units','sap_bom_headers','sap_bom_items','mrp_runs','sap_import_headers','product_sap_link_history'))
) AS audit;
