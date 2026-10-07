-- Plan Maestro de Producción (MPS), políticas laborales, pronóstico, pedidos especiales, aprendizaje y vínculo BOM ↔ SAP.
-- Solo crea tablas y funciones nuevas y agrega filas de configuración: no modifica productos, BOM, estructuras ni listas SAP.
BEGIN;

-- ============================================================
-- Políticas laborales con fecha de vigencia (cambian con la ley: se conserva el historial)
-- ============================================================
CREATE TABLE public.labor_policies(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 valid_from date NOT NULL UNIQUE,
 base_salary numeric(10,2) NOT NULL CHECK(base_salary>0),
 monthly_hours numeric(6,2) NOT NULL DEFAULT 240 CHECK(monthly_hours>0),
 overtime_surcharge_pct numeric(6,2) NOT NULL DEFAULT 50 CHECK(overtime_surcharge_pct>=0),
 extraordinary_surcharge_pct numeric(6,2) NOT NULL DEFAULT 100 CHECK(extraordinary_surcharge_pct>=0),
 max_overtime_day numeric(4,2) NOT NULL DEFAULT 4 CHECK(max_overtime_day BETWEEN 0 AND 12),
 max_overtime_week numeric(5,2) NOT NULL DEFAULT 12 CHECK(max_overtime_week BETWEEN 0 AND 60),
 saturday_enabled boolean NOT NULL DEFAULT true,
 saturday_max_hours numeric(4,2) NOT NULL DEFAULT 8 CHECK(saturday_max_hours BETWEEN 0 AND 12),
 notes text,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());
-- Valores iniciales de Ecuador (Código del Trabajo: suplementarias +50 %, máx. 4 h/día y 12 h/semana; sábados y feriados +100 %).
-- El sueldo básico se debe confirmar y actualizar cada año desde el ERP.
INSERT INTO public.labor_policies(valid_from,base_salary,notes) VALUES
 ('2026-01-01',482,'Sueldo básico unificado 2026 (confirmar). Valor hora = sueldo ÷ 240.');

-- ============================================================
-- Parámetros del plan maestro (costos, regímenes, ausentismo, rueda ABC, lote)
-- ============================================================
CREATE TABLE public.mps_settings(key text PRIMARY KEY,value jsonb NOT NULL,description text,updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid DEFAULT auth.uid());
INSERT INTO public.mps_settings(key,value,description) VALUES
 ('costs','{"holdingPctMonthly":1,"backlogPenalty":40,"unmetPenalty":200,"forcingPenalty":8}','Costo de inventario (% mensual del costo) y penalizaciones por atraso, demanda no cumplida y forzar restricciones (USD por unidad).'),
 ('regimes','[{"key":"NORMAL","label":"Normal","efficiencyFactor":1,"forcingPct":0,"saturday":false,"overtime":true},{"key":"PRESIONADO","label":"Presionado","efficiencyFactor":1.1,"forcingPct":10,"saturday":true,"overtime":true},{"key":"MAXIMO","label":"Esfuerzo máximo","efficiencyFactor":1.2,"forcingPct":20,"saturday":true,"overtime":true}]','Regímenes de trabajo. Los mínimos se ajustan con lo aprendido de los programas reales.'),
 ('absenteeism','{"min":2,"max":4}','Ausentismo esperado por área (%) cuando no hay asistencia registrada en Restricciones.'),
 ('demand_variation','{"pct":10}','Variación de la demanda para los escenarios baja/alta y Monte Carlo (%).'),
 ('wheel','{"a":0.8,"b":0.95}','Rueda de producción ABC: A todas las semanas, B cada dos semanas, C una vez al mes.'),
 ('lot','{"default":10,"learn":true}','Múltiplo de lote. Si learn=true se usa el aprendido de los programas.'),
 ('area_wages','{}','Valor hora por área (USD) cuando no es el sueldo básico. Clave = id del área.'),
 ('restriction_areas','{}','Área que limita cada restricción diaria (id restricción → id área). Por defecto paneles: Tapicería; colchones: Cerrado.'),
 ('shifts','[{"key":"DIA","name":"Turno día","productivityPct":100,"ordinaryHours":null,"referenceHours":null,"nightSurchargePct":0,"saturday":true,"active":true,"headcount":{}},{"key":"NOCHE","name":"Turno noche","productivityPct":85,"ordinaryHours":null,"referenceHours":null,"nightSurchargePct":25,"saturday":false,"active":true,"headcount":{}}]','Turnos de trabajo: la noche rinde 85 % del día y lleva recargo nocturno (25 %). Personal por turno vacío = personal base del área.');

-- ============================================================
-- Corridas del plan maestro (borrador / aprobado) con su MRP
-- ============================================================
CREATE TABLE public.mps_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(btrim(name)<>''),
 month date NOT NULL CHECK(extract(day FROM month)=1),
 scenario text NOT NULL,
 regime text NOT NULL,
 classification text NOT NULL CHECK(classification IN('OPTIMO','CON_LAS_JUSTAS','NO_ALCANZA')),
 status text NOT NULL DEFAULT 'BORRADOR' CHECK(status IN('BORRADOR','APROBADO','DESCARTADO')),
 inputs jsonb NOT NULL,
 result jsonb NOT NULL,
 mrp jsonb,
 learning_version_id bigint,
 approved_by uuid,
 approved_at timestamptz,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX mps_runs_month ON public.mps_runs(month DESC,created_at DESC);

-- ============================================================
-- Pedidos especiales (se suman a la demanda en su fecha)
-- ============================================================
CREATE TABLE public.mps_special_orders(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 material_code text NOT NULL CHECK(material_code ~ '^\S+$'),
 due_date date NOT NULL,
 quantity numeric(12,2) NOT NULL CHECK(quantity>0),
 customer text,
 notes text,
 status text NOT NULL DEFAULT 'ABIERTO' CHECK(status IN('ABIERTO','CERRADO')),
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX mps_special_orders_date ON public.mps_special_orders(due_date);

-- ============================================================
-- Observaciones mensuales de demanda (historia para el pronóstico)
-- ============================================================
CREATE TABLE public.demand_observations(
 period date NOT NULL CHECK(extract(day FROM period)=1),
 material_code text NOT NULL CHECK(material_code ~ '^\S+$'),
 quantity numeric(14,2) NOT NULL CHECK(quantity>=0),
 source text NOT NULL DEFAULT 'DEMANDA_VIGENTE' CHECK(source IN('DEMANDA_VIGENTE','REAL','MANUAL')),
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(period,material_code));

-- Copia la demanda vigente como observación del mes indicado (se puede repetir: reemplaza ese mes).
CREATE FUNCTION public.record_demand_observation(target date) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n int;
BEGIN
 IF NOT public.can_plan() THEN RAISE EXCEPTION 'Acceso de edición denegado.';END IF;
 IF target IS NULL OR extract(day FROM target)<>1 THEN RAISE EXCEPTION 'Mes inválido.';END IF;
 DELETE FROM public.demand_observations WHERE period=target AND source='DEMANDA_VIGENTE';
 INSERT INTO public.demand_observations(period,material_code,quantity,source)
 SELECT target,material_code,monthly_demand,'DEMANDA_VIGENTE' FROM public.demand_items WHERE active
 ON CONFLICT(period,material_code) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END;$$;
REVOKE ALL ON FUNCTION public.record_demand_observation(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_demand_observation(date) TO authenticated;

-- ============================================================
-- Versiones de lo aprendido de los programas reales
-- ============================================================
CREATE TABLE public.mps_learning_versions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 programs integer NOT NULL,
 learned jsonb NOT NULL,
 regimes jsonb NOT NULL,
 notes text,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());

-- ============================================================
-- Vínculo de cada componente del árbol de ingeniería con su material SAP (no modifica el árbol)
-- ============================================================
CREATE TABLE public.bom_node_material_map(
 node_id bigint PRIMARY KEY REFERENCES public.engineering_bom_nodes(id) ON DELETE CASCADE,
 material_code text NOT NULL CHECK(btrim(material_code)<>''),
 notes text,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX bom_node_material_map_code ON public.bom_node_material_map(material_code);

-- ============================================================
-- Áreas de los puestos indicados por planificación (solo se completa lo que está vacío)
-- Pasado falso y Armado de banda → Costura (fuera del plan por ahora); Ensamblado de panel → Tapicería; Enmarcado → Cerrado;
-- Empacado → Empaque (área de empaque dentro de Resortes, sin personal cargado todavía).
-- ============================================================
INSERT INTO public.production_areas(name,headcount,limits_capacity,notes,sort)
VALUES('COSTURA',NULL,false,'Pasado falso y Armado de banda. Fuera del plan hasta incluir esta área.',5),
      ('EMPAQUE',NULL,false,'Empacado. Área de empaque dentro de Resortes. Cargar su personal para incluirla en el plan.',6)
ON CONFLICT(name) DO NOTHING;
INSERT INTO public.work_centers(code,name,area_id)
SELECT v.code,v.name,a.id FROM (VALUES
 ('LACRPF01','PASADO FALSO','COSTURA'),('LACRRE01','ARMADO DE BANDA','COSTURA'),
 ('LACREN01','ENSAMBLADO DE PANEL','TAPICERÍA'),('LACREE01','ENMARCADO','CERRADO'),
 ('LACREM01','EMPACADO','EMPAQUE')) v(code,name,area)
JOIN public.production_areas a ON a.name=v.area
ON CONFLICT(code) DO UPDATE SET area_id=EXCLUDED.area_id WHERE public.work_centers.area_id IS NULL;

-- ============================================================
-- Permisos: lectura para usuarios activos; escritura para ADMIN, ENGINEERING y PLANNER
-- ============================================================
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['labor_policies','mps_settings','mps_runs','mps_special_orders','demand_observations','mps_learning_versions','bom_node_material_map'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.is_active_user())',t||'_read',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(public.can_plan())',t||'_insert',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(public.can_plan()) WITH CHECK(public.can_plan())',t||'_update',t);
 END LOOP;
 -- Se puede borrar: pedidos especiales, observaciones y vínculos. Las políticas, corridas y versiones quedan como historial.
 FOREACH t IN ARRAY ARRAY['mps_special_orders','demand_observations','bom_node_material_map'] LOOP
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING(public.can_plan())',t||'_delete',t);
 END LOOP;
END$$;
GRANT USAGE ON SEQUENCE public.labor_policies_id_seq,public.mps_special_orders_id_seq,public.mps_learning_versions_id_seq TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
