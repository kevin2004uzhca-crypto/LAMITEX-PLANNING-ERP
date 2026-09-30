BEGIN;
CREATE VIEW public.material_usage_summary WITH(security_invoker=true) AS
 SELECT i.component_code,count(DISTINCT s.id)::integer AS model_count,count(DISTINCT h.id)::integer AS list_count
 FROM public.sap_bom_items i JOIN public.sap_bom_headers h ON h.id=i.sap_bom_header_id AND h.active
 LEFT JOIN public.product_skus s ON s.sap_material_code=h.parent_material_code
 GROUP BY i.component_code;
GRANT SELECT ON public.material_usage_summary TO authenticated;
REVOKE ALL ON public.material_usage_summary FROM anon;
NOTIFY pgrst,'reload schema';
COMMIT;
