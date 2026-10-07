-- Demanda, restricciones de capacidad y programas de entrenamiento.
-- Solo crea tablas y funciones nuevas: no modifica productos, BOM ni estructuras existentes.
BEGIN;

CREATE FUNCTION public.can_plan() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT public.has_any_role(ARRAY['ADMIN','ENGINEERING','PLANNER']) $$;
REVOKE ALL ON FUNCTION public.can_plan() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_plan() TO authenticated;

-- ============================================================
-- Catálogo de letras: tipo de colchón y tipo de panel
-- ============================================================
CREATE TABLE public.planning_codes(
 kind text NOT NULL CHECK(kind IN('COLCHON','PANEL')),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9]{1,4}$'),
 name text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 sort integer NOT NULL DEFAULT 0,
 PRIMARY KEY(kind,code));
INSERT INTO public.planning_codes(kind,code,name,sort) VALUES
 ('COLCHON','T','Tradicional',1),('COLCHON','P','Pillow top',2),('COLCHON','X','Doble pillow top',3),('COLCHON','N','Náutica (colchón de caja)',4),
 ('PANEL','J','Paneles jumbo',1),('PANEL','C','Paneles confort',2),('PANEL','NP','No pertenece a ningún panel',3);

-- ============================================================
-- Demanda vigente por material y su historial completo
-- ============================================================
CREATE TABLE public.demand_imports(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 file_name text NOT NULL,
 file_hash text NOT NULL,
 total_rows integer NOT NULL,
 inserted_rows integer NOT NULL DEFAULT 0,
 updated_rows integer NOT NULL DEFAULT 0,
 unchanged_rows integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.demand_items(
 material_code text PRIMARY KEY CHECK(material_code ~ '^\S+$'),
 description text NOT NULL CHECK(btrim(description)<>''),
 mattress_type text NOT NULL,
 panel_type text NOT NULL DEFAULT 'NP',
 size_cm numeric(8,2) CHECK(size_cm IS NULL OR size_cm>0),
 monthly_demand numeric(14,2) NOT NULL DEFAULT 0 CHECK(monthly_demand>=0),
 active boolean NOT NULL DEFAULT true,
 notes text,
 last_source text NOT NULL DEFAULT 'MANUAL' CHECK(last_source IN('MANUAL','CARGA_MASIVA')),
 last_import_id bigint REFERENCES public.demand_imports(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid DEFAULT auth.uid(),
 mattress_kind text NOT NULL GENERATED ALWAYS AS ('COLCHON') STORED,
 panel_kind text NOT NULL GENERATED ALWAYS AS ('PANEL') STORED,
 FOREIGN KEY(mattress_kind,mattress_type) REFERENCES public.planning_codes(kind,code),
 FOREIGN KEY(panel_kind,panel_type) REFERENCES public.planning_codes(kind,code));
CREATE INDEX demand_items_types ON public.demand_items(mattress_type,panel_type);

CREATE TABLE public.demand_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 material_code text NOT NULL,
 description text NOT NULL,
 mattress_type text NOT NULL,
 panel_type text NOT NULL,
 size_cm numeric(8,2),
 monthly_demand numeric(14,2) NOT NULL,
 active boolean NOT NULL,
 source text NOT NULL,
 import_id bigint,
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX demand_history_material_time ON public.demand_history(material_code,changed_at DESC,id DESC);
CREATE INDEX demand_history_time ON public.demand_history(changed_at);

-- Cada alta o cambio real deja una fotografía con fecha: permite reconstruir la demanda a cualquier fecha.
CREATE FUNCTION public.demand_items_track() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.description,NEW.mattress_type,NEW.panel_type,NEW.size_cm,NEW.monthly_demand,NEW.active)
    IS NOT DISTINCT FROM (OLD.description,OLD.mattress_type,OLD.panel_type,OLD.size_cm,OLD.monthly_demand,OLD.active) THEN
  RETURN NEW;
 END IF;
 INSERT INTO public.demand_history(material_code,description,mattress_type,panel_type,size_cm,monthly_demand,active,source,import_id,changed_by)
 VALUES(NEW.material_code,NEW.description,NEW.mattress_type,NEW.panel_type,NEW.size_cm,NEW.monthly_demand,NEW.active,NEW.last_source,NEW.last_import_id,auth.uid());
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.demand_items_track() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER demand_items_history AFTER INSERT OR UPDATE ON public.demand_items FOR EACH ROW EXECUTE FUNCTION public.demand_items_track();

CREATE FUNCTION public.demand_items_touch() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at=now(); NEW.updated_by=auth.uid(); RETURN NEW; END;$$;
CREATE TRIGGER demand_items_touch BEFORE UPDATE ON public.demand_items FOR EACH ROW EXECUTE FUNCTION public.demand_items_touch();

-- Demanda tal como estaba en una fecha: último estado registrado de cada material hasta ese instante.
CREATE FUNCTION public.demand_as_of(at_time timestamptz) RETURNS SETOF public.demand_history
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT DISTINCT ON(h.material_code) h.* FROM public.demand_history h
 WHERE h.changed_at<=at_time ORDER BY h.material_code,h.changed_at DESC,h.id DESC $$;
REVOKE ALL ON FUNCTION public.demand_as_of(timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.demand_as_of(timestamptz) TO authenticated;

-- Carga masiva: inserta modelos nuevos y actualiza los existentes en una sola transacción.
-- Los materiales que no vienen en el archivo se conservan sin cambios.
CREATE FUNCTION public.import_demand(payload jsonb,source_hash text,source_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE imp bigint; ins int; upd int; total int;
BEGIN
 IF NOT public.can_plan() THEN RAISE EXCEPTION 'Acceso de edición denegado.';END IF;
 IF source_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Archivo o huella inválidos.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lamitex-demand-import',0));
 CREATE TEMP TABLE demand_incoming ON COMMIT DROP AS SELECT x.* FROM jsonb_to_recordset(payload) x(material_code text,description text,mattress_type text,panel_type text,size_cm numeric,monthly_demand numeric);
 IF EXISTS(SELECT 1 FROM demand_incoming GROUP BY material_code HAVING count(*)>1) THEN RAISE EXCEPTION 'Hay materiales repetidos en el archivo.';END IF;
 IF EXISTS(SELECT 1 FROM demand_incoming i WHERE NOT EXISTS(SELECT 1 FROM public.planning_codes c WHERE c.kind='COLCHON' AND c.code=i.mattress_type)) THEN RAISE EXCEPTION 'Hay tipos de colchón que no existen en el catálogo.';END IF;
 IF EXISTS(SELECT 1 FROM demand_incoming i WHERE NOT EXISTS(SELECT 1 FROM public.planning_codes c WHERE c.kind='PANEL' AND c.code=i.panel_type)) THEN RAISE EXCEPTION 'Hay tipos de panel que no existen en el catálogo.';END IF;
 total=jsonb_array_length(payload);
 INSERT INTO public.demand_imports(file_name,file_hash,total_rows) VALUES(source_name,source_hash,total) RETURNING id INTO imp;
 SELECT count(*) INTO upd FROM demand_incoming i JOIN public.demand_items d ON d.material_code=i.material_code
  WHERE (d.description,d.mattress_type,d.panel_type,d.size_cm,d.monthly_demand,d.active) IS DISTINCT FROM (i.description,i.mattress_type,i.panel_type,i.size_cm,i.monthly_demand,true);
 SELECT count(*) INTO ins FROM demand_incoming i WHERE NOT EXISTS(SELECT 1 FROM public.demand_items d WHERE d.material_code=i.material_code);
 INSERT INTO public.demand_items(material_code,description,mattress_type,panel_type,size_cm,monthly_demand,active,last_source,last_import_id)
 SELECT material_code,description,mattress_type,panel_type,size_cm,monthly_demand,true,'CARGA_MASIVA',imp FROM demand_incoming
 ON CONFLICT(material_code) DO UPDATE SET description=EXCLUDED.description,mattress_type=EXCLUDED.mattress_type,panel_type=EXCLUDED.panel_type,
  size_cm=EXCLUDED.size_cm,monthly_demand=EXCLUDED.monthly_demand,active=true,last_source='CARGA_MASIVA',last_import_id=imp
 WHERE (public.demand_items.description,public.demand_items.mattress_type,public.demand_items.panel_type,public.demand_items.size_cm,public.demand_items.monthly_demand,public.demand_items.active)
  IS DISTINCT FROM (EXCLUDED.description,EXCLUDED.mattress_type,EXCLUDED.panel_type,EXCLUDED.size_cm,EXCLUDED.monthly_demand,true);
 UPDATE public.demand_imports SET inserted_rows=ins,updated_rows=upd,unchanged_rows=total-ins-upd WHERE id=imp;
 RETURN jsonb_build_object('importId',imp,'inserted',ins,'updated',upd,'unchanged',total-ins-upd,'rows',total);
END;$$;
REVOKE ALL ON FUNCTION public.import_demand(jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_demand(jsonb,text,text) TO authenticated;

-- ============================================================
-- Restricciones de capacidad diaria (programación diaria actual)
-- ============================================================
CREATE TABLE public.capacity_restrictions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL CHECK(btrim(name)<>''),
 applies_to text NOT NULL CHECK(applies_to IN('COLCHON','PANEL')),
 codes text[] NOT NULL CHECK(cardinality(codes)>0),
 sizes numeric[],
 max_per_day numeric(10,2) NOT NULL CHECK(max_per_day>=0),
 active boolean NOT NULL DEFAULT true,
 notes text,
 sort integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid DEFAULT auth.uid());
INSERT INTO public.capacity_restrictions(name,applies_to,codes,sizes,max_per_day,notes,sort) VALUES
 ('COLCHÓN DE CAJA','COLCHON',ARRAY['X','N'],NULL,150,'X y N comparten estaciones de trabajo: el máximo es la suma de ambos.',1),
 ('PILLOW TOP','COLCHON',ARRAY['P'],NULL,40,NULL,2),
 ('MEDIDA 160 Y 200','COLCHON',ARRAY['T'],ARRAY[160,200]::numeric[],100,'Tradicionales de medida 160 y 200 (según el Excel de restricciones).',3),
 ('PANELES JUMBO','PANEL',ARRAY['J'],NULL,150,NULL,4),
 ('PANELES CONFORT','PANEL',ARRAY['C'],NULL,200,NULL,5);

-- ============================================================
-- Personal, asistencia y jornada laboral
-- ============================================================
CREATE TABLE public.production_areas(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL UNIQUE CHECK(btrim(name)<>''),
 headcount integer CHECK(headcount IS NULL OR headcount>=0),
 default_attendance_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK(default_attendance_pct BETWEEN 0 AND 100),
 limits_capacity boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 notes text,
 sort integer NOT NULL DEFAULT 0);
-- Personal base indicado por planificación; se ajusta desde el ERP.
INSERT INTO public.production_areas(name,headcount,limits_capacity,notes,sort) VALUES
 ('TAPICERÍA',14,true,'Área clave con más ausentismo.',1),
 ('CERRADO',10,true,'Área clave con más ausentismo.',2),
 ('MARCOS',2,false,NULL,3),
 ('SELLADO',2,false,NULL,4);

CREATE TABLE public.attendance_month(
 month date NOT NULL CHECK(extract(day FROM month)=1),
 area_id bigint NOT NULL REFERENCES public.production_areas(id) ON DELETE CASCADE,
 attendance_pct numeric(5,2) NOT NULL CHECK(attendance_pct BETWEEN 0 AND 100),
 PRIMARY KEY(month,area_id));
CREATE TABLE public.attendance_day(
 day date NOT NULL,
 area_id bigint NOT NULL REFERENCES public.production_areas(id) ON DELETE CASCADE,
 attendance_pct numeric(5,2) NOT NULL CHECK(attendance_pct BETWEEN 0 AND 100),
 note text,
 PRIMARY KEY(day,area_id));

-- Semana tipo (1=lunes … 7=domingo, ISO).
CREATE TABLE public.work_week(
 weekday smallint PRIMARY KEY CHECK(weekday BETWEEN 1 AND 7),
 is_working boolean NOT NULL,
 start_time time NOT NULL,
 end_time time NOT NULL,
 break_minutes integer NOT NULL DEFAULT 0 CHECK(break_minutes BETWEEN 0 AND 600),
 ordinary_hours numeric(4,2) NOT NULL DEFAULT 8 CHECK(ordinary_hours BETWEEN 0 AND 24),
 CHECK(end_time>start_time));
INSERT INTO public.work_week VALUES
 (1,true,'07:00','19:00',60,8),(2,true,'07:00','19:00',60,8),(3,true,'07:00','19:00',60,8),(4,true,'07:00','19:00',60,8),(5,true,'07:00','19:00',60,8),
 (6,false,'07:00','17:00',60,0),(7,false,'07:00','15:00',0,0);

-- Excepciones por fecha: sábados trabajados, feriados, jornadas recortadas.
CREATE TABLE public.work_days(
 day date PRIMARY KEY,
 is_working boolean NOT NULL,
 start_time time NOT NULL,
 end_time time NOT NULL,
 break_minutes integer NOT NULL DEFAULT 0 CHECK(break_minutes BETWEEN 0 AND 600),
 ordinary_hours numeric(4,2) NOT NULL DEFAULT 0 CHECK(ordinary_hours BETWEEN 0 AND 24),
 note text,
 CHECK(end_time>start_time));

CREATE TABLE public.planning_settings(key text PRIMARY KEY,value jsonb NOT NULL,description text);
INSERT INTO public.planning_settings VALUES
 ('reference_hours','11','Horas netas de la jornada en la que se definió el máximo por día (07:00-19:00 menos 1 h de almuerzo).');

-- ============================================================
-- Programas de entrenamiento (programaciones reales del tutor)
-- ============================================================
CREATE TABLE public.training_programs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL CHECK(btrim(name)<>''),
 weekday text NOT NULL CHECK(weekday IN('LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO')),
 program_date date,
 source_file text,
 sheet_name text,
 file_hash text,
 notes text,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.training_program_lines(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 program_id bigint NOT NULL REFERENCES public.training_programs(id) ON DELETE CASCADE,
 material_code text NOT NULL,
 description text,
 quantity numeric(12,2) NOT NULL CHECK(quantity>=0),
 source_row integer);
CREATE INDEX training_lines_program ON public.training_program_lines(program_id);

CREATE FUNCTION public.import_training_programs(payload jsonb,source_hash text,source_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p jsonb; pid bigint; created jsonb='[]'::jsonb;
BEGIN
 IF NOT public.can_plan() THEN RAISE EXCEPTION 'Acceso de edición denegado.';END IF;
 IF source_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Archivo o huella inválidos.';END IF;
 FOR p IN SELECT * FROM jsonb_array_elements(payload) LOOP
  INSERT INTO public.training_programs(name,weekday,program_date,source_file,sheet_name,file_hash)
  VALUES(p->>'name',p->>'weekday',NULLIF(p->>'program_date','')::date,source_name,p->>'sheet',source_hash) RETURNING id INTO pid;
  INSERT INTO public.training_program_lines(program_id,material_code,description,quantity,source_row)
  SELECT pid,x.material_code,x.description,x.quantity,x.source_row FROM jsonb_to_recordset(p->'lines') x(material_code text,description text,quantity numeric,source_row integer);
  created=created||jsonb_build_object('id',pid,'name',p->>'name');
 END LOOP;
 RETURN jsonb_build_object('programs',created);
END;$$;
REVOKE ALL ON FUNCTION public.import_training_programs(jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_training_programs(jsonb,text,text) TO authenticated;

-- ============================================================
-- Permisos: lectura para usuarios activos; escritura para ADMIN, ENGINEERING y PLANNER
-- ============================================================
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['planning_codes','demand_items','capacity_restrictions','production_areas','attendance_month','attendance_day','work_week','work_days','planning_settings','training_programs','training_program_lines'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.is_active_user())',t||'_read',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(public.can_plan())',t||'_insert',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(public.can_plan()) WITH CHECK(public.can_plan())',t||'_update',t);
 END LOOP;
 -- Borrado solo en configuración y entrenamiento; la demanda se desactiva, nunca se borra.
 FOREACH t IN ARRAY ARRAY['capacity_restrictions','attendance_month','attendance_day','work_days','training_programs','training_program_lines'] LOOP
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING(public.can_plan())',t||'_delete',t);
 END LOOP;
END$$;
ALTER TABLE public.demand_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.demand_history TO authenticated;
CREATE POLICY demand_history_read ON public.demand_history FOR SELECT TO authenticated USING(public.is_active_user());
ALTER TABLE public.demand_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.demand_imports TO authenticated;
CREATE POLICY demand_imports_read ON public.demand_imports FOR SELECT TO authenticated USING(public.is_active_user());
CREATE POLICY demand_imports_insert ON public.demand_imports FOR INSERT TO authenticated WITH CHECK(public.can_plan() AND created_by=auth.uid());
CREATE POLICY demand_imports_update ON public.demand_imports FOR UPDATE TO authenticated USING(public.can_plan() AND created_by=auth.uid());
GRANT USAGE ON SEQUENCE public.demand_imports_id_seq,public.capacity_restrictions_id_seq,public.production_areas_id_seq,public.training_programs_id_seq,public.training_program_lines_id_seq TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
