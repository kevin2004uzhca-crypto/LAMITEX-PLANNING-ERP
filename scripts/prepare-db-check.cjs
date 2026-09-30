const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pilot = JSON.parse(fs.readFileSync(path.join(root, 'src/data/pilot.json'), 'utf8'));
pilot.associationConfirmed = true;
const literal = JSON.stringify(pilot).replaceAll("'", "''");
const sql = `-- QA only: all row changes are isolated and rolled back. Identity sequences may advance.
BEGIN;
DO $qa$
DECLARE actor uuid; sku bigint; second_sku bigint; model_id bigint; total int; denied boolean; p jsonb := '${literal}'::jsonb; src jsonb;
BEGIN
 SELECT user_id INTO actor FROM public.user_profiles WHERE role='ADMIN' AND active LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No active ADMIN profile to test.'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 FOR src IN SELECT * FROM jsonb_array_elements(p->'sources') LOOP
   INSERT INTO public.imports(import_type,file_name,file_hash,status,notes)
   VALUES('SOURCE_ARCHIVE',src->>'file',src->>'sha256','STAGED','QA transaction; rolled back, not an actual Storage upload');
 END LOOP;
 sku := public.import_pilot_101(p);
 second_sku := public.import_pilot_101(p);
 IF sku IS DISTINCT FROM second_sku THEN RAISE EXCEPTION 'Idempotency failed'; END IF;
 SELECT count(*) INTO total FROM public.engineering_bom_nodes n JOIN public.engineering_boms b ON b.id=n.engineering_bom_id WHERE b.product_sku_id=sku;
 IF total <> 10 THEN RAISE EXCEPTION 'Expected 10 engineering nodes, got %',total; END IF;
 SELECT count(*) INTO total FROM public.sap_bom_items i JOIN public.sap_bom_headers h ON h.id=i.sap_bom_header_id WHERE h.product_sku_id=sku;
 IF total <> 19 THEN RAISE EXCEPTION 'Expected 19 SAP items, got %',total; END IF;
 SELECT product_model_id INTO model_id FROM public.product_skus WHERE id=sku;
 RAISE NOTICE 'PASS: ADMIN import, 10 nodes, 19 SAP items and idempotency';
 RESET ROLE;
 UPDATE public.user_profiles SET role='ENGINEERING' WHERE user_id=actor;
 SET LOCAL ROLE authenticated;
 UPDATE public.product_models SET canonical_name='POCKET BOREAL MEMORY FOAM' WHERE id=model_id;
 GET DIAGNOSTICS total = ROW_COUNT;
 IF total <> 1 THEN RAISE EXCEPTION 'ENGINEERING update denied'; END IF;
 RAISE NOTICE 'PASS: ENGINEERING permitted update';
 RESET ROLE;
 UPDATE public.user_profiles SET role='VIEWER' WHERE user_id=actor;
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO total FROM public.product_skus WHERE id=sku;
 IF total <> 1 THEN RAISE EXCEPTION 'VIEWER read denied'; END IF;
 denied := false;
 BEGIN
   INSERT INTO public.product_models(catalog_name_original) VALUES('POCKET BOREAL MEMORY FOAM');
 EXCEPTION WHEN insufficient_privilege THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'VIEWER incorrectly allowed INSERT'; END IF;
 UPDATE public.product_models SET canonical_name='POCKET BOREAL MEMORY FOAM' WHERE id=model_id;
 GET DIAGNOSTICS total = ROW_COUNT;
 IF total <> 0 THEN RAISE EXCEPTION 'VIEWER incorrectly allowed UPDATE'; END IF;
 denied := false;
 BEGIN PERFORM public.import_pilot_101(p); EXCEPTION WHEN raise_exception THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'VIEWER incorrectly allowed RPC'; END IF;
 RAISE NOTICE 'PASS: VIEWER can read, cannot insert/update/import';
 RESET ROLE;
 SET LOCAL ROLE anon;
 denied := false;
 BEGIN PERFORM id FROM public.product_skus LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Anonymous read incorrectly allowed'; END IF;
 RAISE NOTICE 'PASS: anonymous data access denied';
 RESET ROLE;
END;
$qa$;
ROLLBACK;
SELECT 'PASS: transactional import/idempotency/role checks completed; row changes rolled back' AS qa_result;
`;
fs.writeFileSync(path.join(root, 'reports/db-rollback-check.sql'), sql);
console.log('Prepared isolated rollback checks, using real pilot data; no credentials in file.');
