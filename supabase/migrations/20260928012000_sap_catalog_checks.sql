BEGIN;
CREATE FUNCTION public.sap_catalog_checks() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH items AS MATERIALIZED (SELECT i.* FROM public.sap_bom_items i JOIN public.sap_bom_headers h ON h.id=i.sap_bom_header_id WHERE h.active),
 units AS (SELECT component_code, array_agg(DISTINCT component_unit) AS units FROM items GROUP BY component_code HAVING count(DISTINCT component_unit)>1),
 descriptions AS (SELECT component_code,array_agg(DISTINCT component_description) AS descriptions FROM items GROUP BY component_code HAVING count(DISTINCT component_description)>1)
 SELECT jsonb_build_object('multipleUnits',COALESCE((SELECT jsonb_agg(units) FROM units),'[]'::jsonb),'conflictingDescriptions',COALESCE((SELECT jsonb_agg(descriptions) FROM descriptions),'[]'::jsonb),
 'negativePositions',(SELECT count(*) FROM items WHERE component_quantity<0),
 'invalidPositions',(SELECT count(*) FROM items WHERE NULLIF(component_code,'') IS NULL OR component_quantity IS NULL OR NULLIF(component_unit,'') IS NULL OR material_id IS NULL),
 'invalidBases',(SELECT count(*) FROM public.sap_bom_headers WHERE active AND (base_quantity IS NULL OR base_quantity<=0 OR NULLIF(base_unit,'') IS NULL)),
 'missingFamilies',(SELECT count(*) FROM public.materials WHERE material_family_id IS NULL),
 'missingClassifications',(SELECT count(*) FROM public.materials WHERE mrp_classification IS NULL),
 'unconfirmedUnits',COALESCE((SELECT jsonb_agg(code ORDER BY code) FROM public.material_units WHERE NOT confirmed),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.sap_catalog_checks() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sap_catalog_checks() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
