BEGIN;
DO $qa$
DECLARE actor uuid; role_name text; denied boolean; total int; result jsonb; payload jsonb; before_headers int; before_items int; rid uuid;
BEGIN
 SELECT user_id INTO actor FROM public.user_profiles WHERE role='ADMIN' AND active LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No ADMIN'; END IF;
 IF (SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM public.product_models m)<>'dfb66b93b39411a807abab99af28dd56' THEN RAISE EXCEPTION 'Models changed';END IF;
 IF (SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM public.engineering_boms m)<>'2c7cec1ef953a5b6def78099763061ff' THEN RAISE EXCEPTION 'Engineering BOM changed';END IF;
 IF (SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM public.engineering_bom_nodes m)<>'aa20746a57e78a4b28b3aff0ddceeae4' THEN RAISE EXCEPTION 'Engineering nodes changed';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO before_headers FROM public.sap_bom_headers;
 SELECT count(*) INTO before_items FROM public.sap_bom_items;
 result=public.import_sap_materials('[{}]'::jsonb,'b3edd0fc89e897faff4d9e8cf4c5976a3987f3de9551ed44e35f4ddd61f636d3','same.xlsx','Data');
 IF result->>'alreadyImported'<>'true' THEN RAISE EXCEPTION 'Idempotency failed';END IF;
 SELECT jsonb_agg(jsonb_build_object('center',h.center,'alternative',h.alternative,'material',h.parent_material_code,'description',h.parent_description,'base_quantity',h.base_quantity,'base_unit',h.base_unit,'position',i.position,'component',i.component_code,'quantity',i.component_quantity,'unit',i.component_unit,'component_description',i.component_description,'component_alternative',i.component_alternative,'source_row',i.source_row,'raw_source',i.raw_source)) INTO payload FROM public.sap_bom_headers h JOIN public.sap_bom_items i ON i.sap_bom_header_id=h.id WHERE h.parent_material_code='3C83010' AND h.active;
 result=public.import_sap_materials(payload,repeat('a',64),'QA rollback.xlsx','Data');
 IF (result->>'reusedHeaders')::int<>1 OR (result->>'newHeaders')::int<>0 THEN RAISE EXCEPTION 'Identical BOM not reused: %',result;END IF;
 IF (SELECT count(*) FROM public.sap_bom_headers)<>before_headers OR (SELECT count(*) FROM public.sap_bom_items)<>before_items THEN RAISE EXCEPTION 'Duplicate rows created';END IF;
 FOREACH role_name IN ARRAY ARRAY['ADMIN','ENGINEERING','PLANNER','SUPERVISOR','VIEWER'] LOOP
  RESET ROLE;UPDATE public.user_profiles SET role=role_name::public.app_role WHERE user_id=actor;SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.sap_bom_items)<>18199 THEN RAISE EXCEPTION 'Read failed %',role_name;END IF;
  denied=false;BEGIN INSERT INTO public.mrp_runs(status,input,result) VALUES('QA','[]','{}') RETURNING id INTO rid;EXCEPTION WHEN insufficient_privilege THEN denied=true;END;
  IF (role_name='VIEWER') IS DISTINCT FROM denied THEN RAISE EXCEPTION 'MRP permission failed %',role_name;END IF;
  UPDATE public.materials SET notes='QA rollback only' WHERE id=(SELECT min(id) FROM public.materials);GET DIAGNOSTICS total=ROW_COUNT;
  IF (role_name IN('ADMIN','ENGINEERING') AND total<>1) OR (role_name NOT IN('ADMIN','ENGINEERING') AND total<>0) THEN RAISE EXCEPTION 'Material permission failed %',role_name;END IF;
  IF role_name NOT IN('ADMIN','ENGINEERING') THEN
   denied=false;BEGIN PERFORM public.import_sap_materials('[{}]'::jsonb,repeat('b',64),'QA.xlsx','Data');EXCEPTION WHEN raise_exception THEN denied=true;END;
   IF NOT denied THEN RAISE EXCEPTION 'Import authorized for %',role_name;END IF;
   denied=false;BEGIN PERFORM public.set_product_sap_link(2,'3C83010','3C83010');EXCEPTION WHEN raise_exception THEN denied=true;END;
   IF NOT denied THEN RAISE EXCEPTION 'Link authorized for %',role_name;END IF;
  END IF;
 END LOOP;
 RESET ROLE;UPDATE public.user_profiles SET active=false WHERE user_id=actor;SET LOCAL ROLE authenticated;
 IF (SELECT count(*) FROM public.mrp_runs)<>0 OR (SELECT count(*) FROM public.materials)<>0 THEN RAISE EXCEPTION 'Inactive user can read';END IF;
 RESET ROLE;SET LOCAL ROLE anon;denied=false;
 BEGIN PERFORM public.import_sap_materials('[{}]'::jsonb,repeat('b',64),'QA.xlsx','Data');EXCEPTION WHEN insufficient_privilege THEN denied=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Anonymous RPC authorized';END IF;
 RESET ROLE;
END;$qa$;
ROLLBACK;
SELECT 'PASS: preserved all models/engineering hashes; same-file idempotency; identical BOM reuse; all 5 roles; inactive/anonymous denied. Test mutations rolled back.' AS result;
