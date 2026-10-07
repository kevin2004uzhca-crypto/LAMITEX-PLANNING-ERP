-- Costos SAP, inventario (Kardex) y hojas de ruta (tiempos de producción).
-- Solo crea tablas y funciones nuevas: no modifica productos, BOM ni estructuras existentes.
-- La llave de todos los módulos es el código de material SAP.
BEGIN;

INSERT INTO public.planning_settings VALUES
 ('inventory_cost_pct','1','Costo de mantener inventario como porcentaje del costo de producción (valor general; cada material puede tener el suyo).');

-- Registro de cargas masivas de los tres módulos.
CREATE TABLE public.master_imports(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('COSTOS','INVENTARIO','RUTAS')),
 file_name text NOT NULL,
 file_hash text NOT NULL,
 snapshot_date date,
 total_rows integer NOT NULL,
 inserted_rows integer NOT NULL DEFAULT 0,
 updated_rows integer NOT NULL DEFAULT 0,
 unchanged_rows integer NOT NULL DEFAULT 0,
 removed_rows integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now());

-- ============================================================
-- Costos de producción (SAP) y costo de inventario
-- ============================================================
CREATE TABLE public.material_costs(
 material_code text PRIMARY KEY CHECK(btrim(material_code)<>''),
 description text NOT NULL,
 center text,
 valuation_class text,
 material_type text,
 article_group text,
 base_unit text,
 price numeric(18,6) CHECK(price IS NULL OR price>=0),
 currency text NOT NULL DEFAULT 'USD',
 price_updated_at date,
 inventory_cost_pct numeric(7,3) CHECK(inventory_cost_pct IS NULL OR inventory_cost_pct BETWEEN 0 AND 100),
 active boolean NOT NULL DEFAULT true,
 notes text,
 last_source text NOT NULL DEFAULT 'MANUAL' CHECK(last_source IN('MANUAL','CARGA_MASIVA')),
 last_import_id bigint REFERENCES public.master_imports(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid DEFAULT auth.uid());

-- ============================================================
-- Inventario (Kardex): libre utilización por material con fecha de corte
-- ============================================================
CREATE TABLE public.inventory_stock(
 material_code text PRIMARY KEY CHECK(btrim(material_code)<>''),
 description text NOT NULL,
 center text,
 warehouse text,
 warehouse_name text,
 article_group text,
 base_unit text,
 free_stock numeric(18,3) NOT NULL DEFAULT 0,
 in_transit numeric(18,3) NOT NULL DEFAULT 0,
 free_value numeric(18,4),
 stock_date date NOT NULL DEFAULT CURRENT_DATE,
 active boolean NOT NULL DEFAULT true,
 notes text,
 last_source text NOT NULL DEFAULT 'MANUAL' CHECK(last_source IN('MANUAL','CARGA_MASIVA')),
 last_import_id bigint REFERENCES public.master_imports(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid DEFAULT auth.uid());

-- ============================================================
-- Hojas de ruta: operaciones y tiempos por material
-- ============================================================
CREATE TABLE public.work_centers(
 code text PRIMARY KEY CHECK(code ~ '^\S+$'),
 name text NOT NULL,
 area_id bigint REFERENCES public.production_areas(id) ON DELETE SET NULL,
 notes text);

CREATE TABLE public.routing_operations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 material_code text NOT NULL CHECK(btrim(material_code)<>''),
 route_counter text NOT NULL DEFAULT '1',
 operation text NOT NULL CHECK(btrim(operation)<>''),
 center text,
 route_description text,
 control_key text,
 base_quantity numeric(18,4) NOT NULL DEFAULT 1 CHECK(base_quantity>0),
 op_unit text,
 standard_value numeric(18,6) NOT NULL DEFAULT 0 CHECK(standard_value>=0),
 standard_unit text NOT NULL DEFAULT 'H' CHECK(standard_unit IN('H','MIN','S')),
 operation_text text,
 work_center text,
 active boolean NOT NULL DEFAULT true,
 notes text,
 last_source text NOT NULL DEFAULT 'MANUAL' CHECK(last_source IN('MANUAL','CARGA_MASIVA')),
 last_import_id bigint REFERENCES public.master_imports(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid DEFAULT auth.uid(),
 UNIQUE(material_code,route_counter,operation));
CREATE INDEX routing_operations_center ON public.routing_operations(work_center);

-- ============================================================
-- Historial común: cada alta, cambio o eliminación queda con fecha y origen
-- ============================================================
CREATE TABLE public.master_data_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 table_name text NOT NULL,
 material_code text NOT NULL,
 data jsonb NOT NULL,
 source text NOT NULL,
 import_id bigint,
 deleted boolean NOT NULL DEFAULT false,
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX master_history_lookup ON public.master_data_history(table_name,material_code,changed_at DESC);
CREATE INDEX master_history_time ON public.master_data_history(table_name,changed_at);

CREATE FUNCTION public.track_master_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE skip text[]=ARRAY['updated_at','updated_by','last_source','last_import_id','created_at'];n jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  INSERT INTO public.master_data_history(table_name,material_code,data,source,deleted,changed_by)
  VALUES(TG_TABLE_NAME,OLD.material_code,to_jsonb(OLD)-skip,'ELIMINADO',true,auth.uid());
  RETURN OLD;
 END IF;
 n=to_jsonb(NEW)-skip;
 IF TG_OP='UPDATE' AND n=to_jsonb(OLD)-skip THEN RETURN NEW; END IF;
 INSERT INTO public.master_data_history(table_name,material_code,data,source,import_id,changed_by)
 VALUES(TG_TABLE_NAME,NEW.material_code,n,NEW.last_source,NEW.last_import_id,auth.uid());
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.track_master_change() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER material_costs_history AFTER INSERT OR UPDATE ON public.material_costs FOR EACH ROW EXECUTE FUNCTION public.track_master_change();
CREATE TRIGGER inventory_stock_history AFTER INSERT OR UPDATE ON public.inventory_stock FOR EACH ROW EXECUTE FUNCTION public.track_master_change();
CREATE TRIGGER routing_operations_history AFTER INSERT OR UPDATE OR DELETE ON public.routing_operations FOR EACH ROW EXECUTE FUNCTION public.track_master_change();
CREATE TRIGGER material_costs_touch BEFORE UPDATE ON public.material_costs FOR EACH ROW EXECUTE FUNCTION public.demand_items_touch();
CREATE TRIGGER inventory_stock_touch BEFORE UPDATE ON public.inventory_stock FOR EACH ROW EXECUTE FUNCTION public.demand_items_touch();
CREATE TRIGGER routing_operations_touch BEFORE UPDATE ON public.routing_operations FOR EACH ROW EXECUTE FUNCTION public.demand_items_touch();

-- ============================================================
-- Cargas masivas (todo o nada). Lo que no viene en el archivo se conserva.
-- ============================================================
CREATE FUNCTION public.import_material_costs(payload jsonb,source_hash text,source_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE imp bigint;ins int;upd int;total int;
BEGIN
 IF NOT public.can_plan() THEN RAISE EXCEPTION 'Acceso de edición denegado.';END IF;
 IF source_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload) NOT BETWEEN 1 AND 50000 THEN RAISE EXCEPTION 'Archivo o huella inválidos.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lamitex-costs-import',0));
 CREATE TEMP TABLE costs_in ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(payload) x(material_code text,description text,center text,valuation_class text,material_type text,article_group text,base_unit text,price numeric,currency text,price_updated_at date);
 IF EXISTS(SELECT 1 FROM costs_in GROUP BY material_code HAVING count(*)>1) THEN RAISE EXCEPTION 'Hay materiales repetidos en el archivo.';END IF;
 total=jsonb_array_length(payload);
 SELECT count(*) INTO ins FROM costs_in i WHERE NOT EXISTS(SELECT 1 FROM public.material_costs c WHERE c.material_code=i.material_code);
 SELECT count(*) INTO upd FROM costs_in i JOIN public.material_costs c USING(material_code)
  WHERE (c.description,c.center,c.valuation_class,c.material_type,c.article_group,c.base_unit,c.price,c.currency,c.price_updated_at,c.active)
   IS DISTINCT FROM (i.description,i.center,i.valuation_class,i.material_type,i.article_group,i.base_unit,i.price,i.currency,i.price_updated_at,true);
 INSERT INTO public.master_imports(kind,file_name,file_hash,total_rows,inserted_rows,updated_rows,unchanged_rows) VALUES('COSTOS',source_name,source_hash,total,ins,upd,total-ins-upd) RETURNING id INTO imp;
 INSERT INTO public.material_costs AS c(material_code,description,center,valuation_class,material_type,article_group,base_unit,price,currency,price_updated_at,active,last_source,last_import_id)
 SELECT material_code,description,center,valuation_class,material_type,article_group,base_unit,price,currency,price_updated_at,true,'CARGA_MASIVA',imp FROM costs_in
 ON CONFLICT(material_code) DO UPDATE SET description=EXCLUDED.description,center=EXCLUDED.center,valuation_class=EXCLUDED.valuation_class,material_type=EXCLUDED.material_type,
  article_group=EXCLUDED.article_group,base_unit=EXCLUDED.base_unit,price=EXCLUDED.price,currency=EXCLUDED.currency,price_updated_at=EXCLUDED.price_updated_at,active=true,last_source='CARGA_MASIVA',last_import_id=imp
 WHERE (c.description,c.center,c.valuation_class,c.material_type,c.article_group,c.base_unit,c.price,c.currency,c.price_updated_at,c.active)
  IS DISTINCT FROM (EXCLUDED.description,EXCLUDED.center,EXCLUDED.valuation_class,EXCLUDED.material_type,EXCLUDED.article_group,EXCLUDED.base_unit,EXCLUDED.price,EXCLUDED.currency,EXCLUDED.price_updated_at,true);
 RETURN jsonb_build_object('importId',imp,'inserted',ins,'updated',upd,'unchanged',total-ins-upd,'rows',total);
END;$$;

CREATE FUNCTION public.import_inventory(payload jsonb,source_hash text,source_name text,snapshot date) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE imp bigint;ins int;upd int;total int;
BEGIN
 IF NOT public.can_plan() THEN RAISE EXCEPTION 'Acceso de edición denegado.';END IF;
 IF source_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload) NOT BETWEEN 1 AND 50000 THEN RAISE EXCEPTION 'Archivo o huella inválidos.';END IF;
 IF snapshot IS NULL OR snapshot>CURRENT_DATE+1 THEN RAISE EXCEPTION 'Fecha de corte inválida.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lamitex-inventory-import',0));
 CREATE TEMP TABLE stock_in ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(payload) x(material_code text,description text,center text,warehouse text,warehouse_name text,article_group text,base_unit text,free_stock numeric,in_transit numeric,free_value numeric);
 IF EXISTS(SELECT 1 FROM stock_in GROUP BY material_code HAVING count(*)>1) THEN RAISE EXCEPTION 'Hay materiales repetidos en el archivo.';END IF;
 total=jsonb_array_length(payload);
 SELECT count(*) INTO ins FROM stock_in i WHERE NOT EXISTS(SELECT 1 FROM public.inventory_stock s WHERE s.material_code=i.material_code);
 SELECT count(*) INTO upd FROM stock_in i JOIN public.inventory_stock s USING(material_code)
  WHERE (s.description,s.center,s.warehouse,s.base_unit,s.free_stock,s.in_transit,s.free_value,s.active) IS DISTINCT FROM (i.description,i.center,i.warehouse,i.base_unit,coalesce(i.free_stock,0),coalesce(i.in_transit,0),i.free_value,true);
 INSERT INTO public.master_imports(kind,file_name,file_hash,snapshot_date,total_rows,inserted_rows,updated_rows,unchanged_rows) VALUES('INVENTARIO',source_name,source_hash,snapshot,total,ins,upd,total-ins-upd) RETURNING id INTO imp;
 -- Todas las filas del archivo toman la fecha de corte, aunque su cantidad no cambie.
 INSERT INTO public.inventory_stock AS s(material_code,description,center,warehouse,warehouse_name,article_group,base_unit,free_stock,in_transit,free_value,stock_date,active,last_source,last_import_id)
 SELECT material_code,description,center,warehouse,warehouse_name,article_group,base_unit,coalesce(free_stock,0),coalesce(in_transit,0),free_value,snapshot,true,'CARGA_MASIVA',imp FROM stock_in
 ON CONFLICT(material_code) DO UPDATE SET description=EXCLUDED.description,center=EXCLUDED.center,warehouse=EXCLUDED.warehouse,warehouse_name=EXCLUDED.warehouse_name,article_group=EXCLUDED.article_group,
  base_unit=EXCLUDED.base_unit,free_stock=EXCLUDED.free_stock,in_transit=EXCLUDED.in_transit,free_value=EXCLUDED.free_value,stock_date=EXCLUDED.stock_date,active=true,last_source='CARGA_MASIVA',last_import_id=imp;
 RETURN jsonb_build_object('importId',imp,'inserted',ins,'updated',upd,'unchanged',total-ins-upd,'rows',total);
END;$$;

CREATE FUNCTION public.import_routings(payload jsonb,source_hash text,source_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE imp bigint;ins int;upd int;del int;total int;
BEGIN
 IF NOT public.can_plan() THEN RAISE EXCEPTION 'Acceso de edición denegado.';END IF;
 IF source_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload) NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Archivo o huella inválidos.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lamitex-routing-import',0));
 CREATE TEMP TABLE ops_in ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(payload) x(material_code text,route_counter text,operation text,center text,route_description text,control_key text,base_quantity numeric,op_unit text,standard_value numeric,standard_unit text,operation_text text,work_center text);
 IF EXISTS(SELECT 1 FROM ops_in GROUP BY material_code,route_counter,operation HAVING count(*)>1) THEN RAISE EXCEPTION 'Hay operaciones repetidas para el mismo material y hoja de ruta.';END IF;
 total=jsonb_array_length(payload);
 SELECT count(*) INTO ins FROM ops_in i WHERE NOT EXISTS(SELECT 1 FROM public.routing_operations r WHERE r.material_code=i.material_code AND r.route_counter=i.route_counter AND r.operation=i.operation);
 SELECT count(*) INTO upd FROM ops_in i JOIN public.routing_operations r USING(material_code,route_counter,operation)
  WHERE (r.center,r.route_description,r.control_key,r.base_quantity,r.op_unit,r.standard_value,r.standard_unit,r.operation_text,r.work_center,r.active)
   IS DISTINCT FROM (i.center,i.route_description,i.control_key,i.base_quantity,i.op_unit,i.standard_value,i.standard_unit,i.operation_text,i.work_center,true);
 INSERT INTO public.master_imports(kind,file_name,file_hash,total_rows) VALUES('RUTAS',source_name,source_hash,total) RETURNING id INTO imp;
 INSERT INTO public.work_centers(code,name) SELECT DISTINCT ON(work_center) work_center,coalesce(operation_text,work_center) FROM ops_in WHERE work_center IS NOT NULL ORDER BY work_center,operation ON CONFLICT DO NOTHING;
 -- La hoja de ruta de cada material del archivo reemplaza a la anterior: se quitan operaciones que ya no vienen.
 DELETE FROM public.routing_operations r WHERE r.material_code IN(SELECT DISTINCT material_code FROM ops_in)
  AND NOT EXISTS(SELECT 1 FROM ops_in i WHERE i.material_code=r.material_code AND i.route_counter=r.route_counter AND i.operation=r.operation);
 GET DIAGNOSTICS del=ROW_COUNT;
 INSERT INTO public.routing_operations AS r(material_code,route_counter,operation,center,route_description,control_key,base_quantity,op_unit,standard_value,standard_unit,operation_text,work_center,active,last_source,last_import_id)
 SELECT material_code,route_counter,operation,center,route_description,control_key,base_quantity,op_unit,standard_value,standard_unit,operation_text,work_center,true,'CARGA_MASIVA',imp FROM ops_in
 ON CONFLICT(material_code,route_counter,operation) DO UPDATE SET center=EXCLUDED.center,route_description=EXCLUDED.route_description,control_key=EXCLUDED.control_key,base_quantity=EXCLUDED.base_quantity,
  op_unit=EXCLUDED.op_unit,standard_value=EXCLUDED.standard_value,standard_unit=EXCLUDED.standard_unit,operation_text=EXCLUDED.operation_text,work_center=EXCLUDED.work_center,active=true,last_source='CARGA_MASIVA',last_import_id=imp
 WHERE (r.center,r.route_description,r.control_key,r.base_quantity,r.op_unit,r.standard_value,r.standard_unit,r.operation_text,r.work_center,r.active)
  IS DISTINCT FROM (EXCLUDED.center,EXCLUDED.route_description,EXCLUDED.control_key,EXCLUDED.base_quantity,EXCLUDED.op_unit,EXCLUDED.standard_value,EXCLUDED.standard_unit,EXCLUDED.operation_text,EXCLUDED.work_center,true);
 UPDATE public.master_imports SET inserted_rows=ins,updated_rows=upd,unchanged_rows=total-ins-upd,removed_rows=del WHERE id=imp;
 RETURN jsonb_build_object('importId',imp,'inserted',ins,'updated',upd,'unchanged',total-ins-upd,'removed',del,'rows',total);
END;$$;

DO $$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY['import_material_costs(jsonb,text,text)','import_inventory(jsonb,text,text,date)','import_routings(jsonb,text,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated',f);
 END LOOP;
END$$;

-- Áreas de los puestos de trabajo de colchones que se reconocen sin ambigüedad; el resto se asigna desde el ERP.
INSERT INTO public.work_centers(code,name,area_id)
SELECT v.code,v.name,a.id FROM (VALUES('LACRTA01','TAPIZADO','TAPICERÍA'),('LACRCE01','CERRADO COLCHON DE RESORTE','CERRADO'),('LACRDO01','ELABORACION DE MARCOS','MARCOS')) v(code,name,area)
LEFT JOIN public.production_areas a ON a.name=v.area;

-- ============================================================
-- Permisos: lectura para usuarios activos; escritura para ADMIN, ENGINEERING y PLANNER
-- ============================================================
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['material_costs','inventory_stock','work_centers','routing_operations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.is_active_user())',t||'_read',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(public.can_plan())',t||'_insert',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(public.can_plan()) WITH CHECK(public.can_plan())',t||'_update',t);
 END LOOP;
END$$;
-- Solo las operaciones de una hoja de ruta pueden eliminarse (queda registrado en el historial).
GRANT DELETE ON public.routing_operations TO authenticated;
CREATE POLICY routing_operations_delete ON public.routing_operations FOR DELETE TO authenticated USING(public.can_plan());
ALTER TABLE public.master_data_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.master_data_history TO authenticated;
CREATE POLICY master_history_read ON public.master_data_history FOR SELECT TO authenticated USING(public.is_active_user());
ALTER TABLE public.master_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.master_imports TO authenticated;
CREATE POLICY master_imports_read ON public.master_imports FOR SELECT TO authenticated USING(public.is_active_user());
CREATE POLICY master_imports_insert ON public.master_imports FOR INSERT TO authenticated WITH CHECK(public.can_plan() AND created_by=auth.uid());
CREATE POLICY master_imports_update ON public.master_imports FOR UPDATE TO authenticated USING(public.can_plan() AND created_by=auth.uid());
GRANT USAGE ON SEQUENCE public.master_imports_id_seq,public.routing_operations_id_seq TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
