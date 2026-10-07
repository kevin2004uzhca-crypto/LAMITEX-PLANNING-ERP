import 'server-only';
import { requireUser } from './auth';
import type { Area, AttendanceDay, AttendanceMonth, DemandItem, PlanningCode, Restriction, WeekDay, WorkDayException } from './planning';
import type { CostRow, InventoryRow, Operation, WorkCenter } from './masters';

export const PLANNING_ROLES=['ADMIN','ENGINEERING','PLANNER'];
export const canPlan=(role:string)=>PLANNING_ROLES.includes(role);
type Db=Awaited<ReturnType<typeof requireUser>>['db'];

/** Supabase devuelve como máximo 1000 filas por consulta: se pagina hasta traerlas todas. */
export async function fetchAll<T>(build:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>){
 const out:T[]=[];for(let from=0;;from+=1000){const {data,error}=await build(from,from+999);if(error)throw new Error(error.message);out.push(...(data??[]));if(!data||data.length<1000)return out;}
}
const num=<T extends Record<string,any>>(rows:T[],keys:(keyof T)[])=>rows.map(r=>{const o:any={...r};for(const k of keys)o[k]=o[k]===null?null:Number(o[k]);return o as T;});

export async function loadCodes(db:Db){const r=await db.from('planning_codes').select('*').order('kind').order('sort');if(r.error)throw new Error(r.error.message);return r.data as PlanningCode[];}
export async function loadDemand(db:Db){return num(await fetchAll<DemandItem>((a,b)=>db.from('demand_items').select('material_code,description,mattress_type,panel_type,size_cm,monthly_demand,active,notes,updated_at,last_source').order('monthly_demand',{ascending:false}).order('material_code').range(a,b)),['size_cm','monthly_demand']);}
export async function loadRestrictions(db:Db){const r=await db.from('capacity_restrictions').select('*').order('sort').order('id');if(r.error)throw new Error(r.error.message);return num(r.data as Restriction[],['max_per_day']).map(x=>({...x,sizes:x.sizes?.map(Number)??null}));}

export async function loadPlanningConfig(db:Db,month:string){
 const first=`${month}-01`;const [y,m]=month.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
 const [areas,week,days,am,ad,settings]=await Promise.all([
  db.from('production_areas').select('*').order('sort').order('id'),
  db.from('work_week').select('*').order('weekday'),
  db.from('work_days').select('*').gte('day',first).lte('day',last).order('day'),
  db.from('attendance_month').select('*').eq('month',first),
  db.from('attendance_day').select('*').gte('day',first).lte('day',last).order('day'),
  db.from('planning_settings').select('*')]);
 for(const r of [areas,week,days,am,ad,settings])if(r.error)throw new Error(r.error.message);
 const t=(v:string)=>v.slice(0,5);
 const fix=<T extends {start_time:string;end_time:string}>(rows:T[])=>num(rows.map(r=>({...r,start_time:t(r.start_time),end_time:t(r.end_time)})) as any[],['ordinary_hours','break_minutes']) as T[];
 return {
  areas:num(areas.data as Area[],['default_attendance_pct']),
  week:fix(week.data as WeekDay[]),
  exceptions:fix(days.data as WorkDayException[]),
  monthAttendance:num(am.data as AttendanceMonth[],['attendance_pct']),
  dayAttendance:num(ad.data as AttendanceDay[],['attendance_pct']),
  referenceHours:Number(settings.data!.find(s=>s.key==='reference_hours')?.value??11)};
}
export type CostRecord=CostRow&{inventory_cost_pct:number|null;active:boolean;notes:string|null;updated_at:string;last_source:string};
export type StockRecord=InventoryRow&{stock_date:string;active:boolean;notes:string|null;updated_at:string;last_source:string};
export async function loadCosts(db:Db){return num(await fetchAll<CostRecord>((a,b)=>db.from('material_costs').select('material_code,description,center,valuation_class,material_type,article_group,base_unit,price,currency,price_updated_at,inventory_cost_pct,active,notes,updated_at,last_source').order('material_code').range(a,b)),['price','inventory_cost_pct']);}
export async function loadStock(db:Db){return num(await fetchAll<StockRecord>((a,b)=>db.from('inventory_stock').select('material_code,description,center,warehouse,warehouse_name,article_group,base_unit,free_stock,in_transit,free_value,stock_date,active,notes,updated_at,last_source').order('material_code').range(a,b)),['free_stock','in_transit','free_value']);}
export async function loadOperations(db:Db){return num(await fetchAll<Operation>((a,b)=>db.from('routing_operations').select('id,material_code,route_counter,operation,center,route_description,control_key,base_quantity,op_unit,standard_value,standard_unit,operation_text,work_center,active,notes,updated_at,last_source').order('material_code').order('route_counter').order('operation').range(a,b)),['base_quantity','standard_value']);}
export async function loadWorkCenters(db:Db){const r=await db.from('work_centers').select('*').order('code');if(r.error)throw new Error(r.error.message);return r.data as WorkCenter[];}
export async function loadSetting(db:Db,key:string,fallback:number){const r=await db.from('planning_settings').select('value').eq('key',key).maybeSingle();if(r.error)throw new Error(r.error.message);return r.data?Number(r.data.value):fallback;}
export async function loadMasterImports(db:Db,kind:string){const r=await db.from('master_imports').select('id,file_name,created_at,snapshot_date,total_rows,inserted_rows,updated_rows,unchanged_rows,removed_rows').eq('kind',kind).order('created_at',{ascending:false}).limit(8);if(r.error)throw new Error(r.error.message);return r.data;}
export const currentMonth=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'}).slice(0,7);
