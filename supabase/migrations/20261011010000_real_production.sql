-- ============================================================
-- LAMITEX · PRODUCCIÓN REAL Y PANEL DE PRODUCCIÓN
-- El programa del día pasa a cargarse desde el ERP (módulo Producción real)
-- y los usuarios del ERP pueden ver el avance de empaque y bodega en el panel.
--
-- Migración ADITIVA: no crea ni modifica datos. Agrega políticas de lectura
-- para los usuarios activos del ERP y amplía quién puede guardar el programa
-- del día (los planificadores del ERP, además del administrador QR).
-- ============================================================
BEGIN;

-- Lectura para los usuarios activos del ERP (panel de producción y Producción real).
-- Empacador, bodega y oficina siguen leyendo con la política lmx_qr_read de antes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lmx_qr_daily_plans','lmx_qr_day_closures','lmx_qr_labels','lmx_qr_scans','lmx_qr_batches','lmx_qr_batch_lines'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS lmx_qr_erp_read ON public.%I', t);
    EXECUTE format('CREATE POLICY lmx_qr_erp_read ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())', t);
  END LOOP;
END
$$;

-- Guarda (reemplaza) el programa real de un día. Igual que antes, pero también lo pueden
-- guardar ADMIN, ENGINEERING y PLANNER del ERP desde el módulo Producción real.
CREATE OR REPLACE FUNCTION public.lmx_qr_save_plan(p_date date, p_lines jsonb, p_source text, p_mps_run uuid, p_notes text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l jsonb; n integer := 0;
BEGIN
  IF NOT (public.lmx_qr_can(ARRAY['ADMIN']) OR public.has_any_role(ARRAY['ADMIN','ENGINEERING','PLANNER'])) THEN
    RAISE EXCEPTION 'Solo el administrador o planificación pueden cargar el programa.';
  END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'Elige la fecha del programa.'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Programa no válido.'; END IF;
  IF jsonb_array_length(p_lines) > 1000 THEN RAISE EXCEPTION 'Máximo 1000 filas por día.'; END IF;
  DELETE FROM public.lmx_qr_daily_plans WHERE plan_date = p_date;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF COALESCE(trim(l->>'sap_code'), '') = '' OR COALESCE((l->>'quantity')::integer, 0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.lmx_qr_daily_plans (plan_date, sap_code, model_name, quantity, source, mps_run_id, notes)
    VALUES (p_date, upper(trim(l->>'sap_code')), COALESCE(NULLIF(trim(l->>'model_name'), ''), upper(trim(l->>'sap_code'))), (l->>'quantity')::integer,
            COALESCE(p_source, 'MANUAL'), p_mps_run, NULLIF(trim(p_notes), ''))
    ON CONFLICT (plan_date, sap_code) DO UPDATE SET quantity = public.lmx_qr_daily_plans.quantity + EXCLUDED.quantity, updated_at = now();
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.lmx_qr_save_plan(date, jsonb, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lmx_qr_save_plan(date, jsonb, text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
