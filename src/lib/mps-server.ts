import 'server-only';
import { requireUser } from './auth';
import { buildCalendar, type DemandItem } from './planning';
import { fetchAll, loadDemand, loadOperations, loadPlanningConfig, loadRestrictions, loadStock, loadWorkCenters, loadCosts } from './planning-server';
import { buildAreas, buildDays, buildGroups, buildProducts, hoursByArea, learnFromPrograms, regimesFromLearning, type Learned, type SapList } from './mps-data';
import { DEFAULT_COSTS, DEFAULT_POLICY, DEFAULT_REGIMES, DEFAULT_SHIFTS, type LaborPolicy, type MpsShift, type MpsCosts, type MpsInput, type Regime, type SpecialOrder } from './mps';
import type { MaterialInfo, SapListFull, Tree } from './mrp-net';
// @ts-ignore: el paquete no publica tipos para la importación por defecto en todos los entornos
import loadHighs from 'highs';

type Db=Awaited<ReturnType<typeof requireUser>>['db'];
let highsPromise:Promise<any>|null=null;
/** HiGHS se carga una sola vez por proceso (WebAssembly). */
export const getHighs=()=>highsPromise??=loadHighs();

/** Tablas nuevas del plan maestro: si todavía no se crearon, el módulo funciona con valores por defecto (vista previa). */
const missing=(e:{code?:string;message?:string}|null)=>!!e&&(e.code==='PGRST205'||e.code==='42P01'||/does not exist|schema cache/i.test(e.message??''));
async function optional<T>(q:PromiseLike<{data:T|null;error:any}>):Promise<{data:T|null;ready:boolean}>{const r=await q;if(r.error){if(missing(r.error))return {data:null,ready:false};throw new Error(r.error.message);}return {data:r.data,ready:true};}

export type MpsSettings={costs:MpsCosts;regimes:Regime[];absenteeism:{min:number;max:number};demandVariation:number;wheel:{a:number;b:number};lot:{default:number;learn:boolean};areaWages:Record<string,number|null>;restrictionAreas:Record<number,number>;shifts:MpsShift[]};
export const DEFAULT_SETTINGS:MpsSettings={costs:DEFAULT_COSTS,regimes:DEFAULT_REGIMES,absenteeism:{min:2,max:4},demandVariation:10,wheel:{a:0.8,b:0.95},lot:{default:10,learn:true},areaWages:{},restrictionAreas:{},shifts:DEFAULT_SHIFTS};
export type PolicyRow=LaborPolicy&{id?:number;valid_from:string;notes?:string|null;created_at?:string};

export async function loadPolicies(db:Db){
 const r=await optional(db.from('labor_policies').select('*').order('valid_from',{ascending:false}));
 const rows:PolicyRow[]=(r.data as any[]??[]).map(p=>({id:p.id,valid_from:p.valid_from,notes:p.notes,created_at:p.created_at,baseSalary:Number(p.base_salary),monthlyHours:Number(p.monthly_hours),overtimeSurchargePct:Number(p.overtime_surcharge_pct),extraordinarySurchargePct:Number(p.extraordinary_surcharge_pct),maxOvertimeDay:Number(p.max_overtime_day),maxOvertimeWeek:Number(p.max_overtime_week),saturdayEnabled:p.saturday_enabled,saturdayMaxHours:Number(p.saturday_max_hours)}));
 return {rows,ready:r.ready};
}
/** Política vigente para un mes: la de fecha de vigencia más reciente que no sea posterior al fin del mes. */
export const policyFor=(rows:PolicyRow[],month:string):LaborPolicy=>{const [y,m]=month.split('-').map(Number);const end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);return rows.find(r=>r.valid_from<=end)??rows[rows.length-1]??DEFAULT_POLICY;};

/** Turnos guardados (o los de por defecto: día 100 % y noche 85 %), con valores sanos. */
export function normalizeShifts(raw:unknown):MpsShift[]{
 if(!Array.isArray(raw)||!raw.length)return DEFAULT_SHIFTS;
 const n=(x:unknown)=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
 return raw.slice(0,4).map((x:any,i)=>({key:String(x?.key??`T${i+1}`).slice(0,20),name:String(x?.name??`Turno ${i+1}`).slice(0,60),productivityPct:Math.min(150,Math.max(1,n(x?.productivityPct)??100)),
  ordinaryHours:n(x?.ordinaryHours),referenceHours:n(x?.referenceHours),nightSurchargePct:Math.max(0,n(x?.nightSurchargePct)??0),saturday:x?.saturday===true,active:x?.active!==false,
  headcount:Object.fromEntries(Object.entries(x?.headcount??{}).map(([k,v])=>[k,n(v)]))}));
}

export async function loadSettings(db:Db):Promise<{settings:MpsSettings;ready:boolean}>{
 const r=await optional(db.from('mps_settings').select('key,value'));const v=new Map((r.data as any[]??[]).map(x=>[x.key,x.value]));
 return {ready:r.ready,settings:{costs:{...DEFAULT_COSTS,...(v.get('costs')??{})},regimes:v.get('regimes')??DEFAULT_REGIMES,absenteeism:v.get('absenteeism')??DEFAULT_SETTINGS.absenteeism,demandVariation:Number(v.get('demand_variation')?.pct??10),wheel:v.get('wheel')??DEFAULT_SETTINGS.wheel,lot:v.get('lot')??DEFAULT_SETTINGS.lot,areaWages:v.get('area_wages')??{},restrictionAreas:v.get('restriction_areas')??{},shifts:normalizeShifts(v.get('shifts'))}};
}

/** Listas SAP activas: para cada código se toma el centro 3001 (o el primero) y la alternativa más baja. */
export async function loadSapLists(db:Db){
 const headers=await fetchAll<any>((a,b)=>db.from('sap_bom_headers').select('id,parent_material_code,parent_description,center,alternative,base_quantity,base_unit,active').eq('active',true).order('id').range(a,b));
 const chosen=new Map<string,any>();
 for(const h of headers){const c=chosen.get(h.parent_material_code);const score=(x:any)=>(x.center==='3001'?0:1)*1000+(Number(x.alternative)||99);if(!c||score(h)<score(c))chosen.set(h.parent_material_code,h);}
 const items=await fetchAll<any>((a,b)=>db.from('sap_bom_items').select('sap_bom_header_id,component_code,component_description,component_quantity,component_unit').order('id').range(a,b));
 const byHeader=new Map<number,any[]>();for(const i of items){const l=byHeader.get(i.sap_bom_header_id)??[];l.push(i);byHeader.set(i.sap_bom_header_id,l);}
 const full=new Map<string,SapListFull>();
 for(const [code,h] of chosen)full.set(code,{headerId:h.id,code,base:Number(h.base_quantity)||1,unit:h.base_unit,items:(byHeader.get(h.id)??[]).map(i=>({code:String(i.component_code).trim(),description:i.component_description,quantity:Number(i.component_quantity),unit:i.component_unit}))});
 return full;
}

/** Árboles BOM de ingeniería activos por código SAP del colchón (revisión más reciente). */
export async function loadTrees(db:Db){
 const boms=await fetchAll<any>((a,b)=>db.from('engineering_boms').select('id,revision,lifecycle,product_skus!inner(sap_material_code)').order('id').range(a,b));
 const best=new Map<string,any>();for(const b of boms){const code=b.product_skus?.sap_material_code?.trim();if(!code||(b.lifecycle&&b.lifecycle!=='ACTIVE'))continue;const c=best.get(code);if(!c||Number(b.revision??1)>Number(c.revision??1))best.set(code,b);}
 const ids=new Set([...best.values()].map(b=>b.id));
 const nodes=await fetchAll<any>((a,b)=>db.from('engineering_bom_nodes').select('id,engineering_bom_id,node_code,parent_node_code,component_name_original,component_name_canonical,quantity,unit,lead_time,node_type,active').order('id').range(a,b));
 const trees=new Map<string,Tree>();
 for(const [code,b] of best)trees.set(code,{bomId:b.id,code,nodes:[]});
 const byBom=new Map([...trees.values()].map(t=>[t.bomId,t]));
 for(const n of nodes){if(!ids.has(n.engineering_bom_id))continue;byBom.get(n.engineering_bom_id)!.nodes.push({id:n.id,key:n.node_code,parentKey:n.parent_node_code,name:n.component_name_canonical||n.component_name_original,quantity:Number(n.quantity),unit:n.unit,leadTime:n.lead_time===null?null:Number(n.lead_time),type:n.node_type,active:n.active!==false});}
 return trees;
}

export async function loadMaterials(db:Db){
 const rows=await fetchAll<any>((a,b)=>db.from('materials').select('sap_code,sap_description_original,lead_time_days,safety_stock,purchase_unit,units_per_purchase,conversion_confirmed,conversion_from_unit,material_families(family_name)').order('id').range(a,b));
 return new Map<string,MaterialInfo>(rows.map(m=>[m.sap_code,{description:m.sap_description_original,family:m.material_families?.family_name??null,leadDays:m.lead_time_days===null?null:Number(m.lead_time_days),safetyStock:m.safety_stock===null?null:Number(m.safety_stock),purchaseUnit:m.purchase_unit,unitsPerPurchase:m.units_per_purchase===null?null:Number(m.units_per_purchase),conversionConfirmed:!!m.conversion_confirmed,conversionFromUnit:m.conversion_from_unit}]));
}

export async function loadPrograms(db:Db){
 const [programs,lines]=await Promise.all([db.from('training_programs').select('id,name,weekday,program_date').order('id'),
  fetchAll<any>((a,b)=>db.from('training_program_lines').select('program_id,material_code,quantity').order('program_id').range(a,b))]);
 if(programs.error)throw new Error(programs.error.message);
 return (programs.data??[]).map(p=>({id:p.id,name:p.name,weekday:p.weekday,date:p.program_date,lines:lines.filter(l=>l.program_id===p.id).map(l=>({material_code:String(l.material_code).trim(),quantity:Number(l.quantity)}))}));
}

/**
 * Reúne todos los módulos para un mes: demanda, restricciones, calendario y asistencia, tiempos (hojas de ruta + listas SAP),
 * costos, inventario, programas reales (aprendizaje), políticas laborales, pedidos especiales y parámetros.
 */
export async function loadMpsContext(db:Db,month:string){
 const [items,restrictions,config,ops,centers,costs,stock,lists,trees,programs,policies,settings,orders,observations]=await Promise.all([
  loadDemand(db),loadRestrictions(db),loadPlanningConfig(db,month),loadOperations(db),loadWorkCenters(db),loadCosts(db),loadStock(db),loadSapLists(db),loadTrees(db),loadPrograms(db),loadPolicies(db),loadSettings(db),
  optional(db.from('mps_special_orders').select('*').eq('status','ABIERTO').order('due_date')),
  fetchAll<any>((a,b)=>db.from('demand_observations').select('period,material_code,quantity,source').order('period').range(a,b)).then(data=>({data,ready:true}),(e:Error)=>/does not exist|schema cache/i.test(e.message)?{data:[],ready:false}:Promise.reject(e))]);
 const calendar=buildCalendar(month,config.week,config.exceptions,config.areas,config.monthAttendance,config.dayAttendance);
 const policy=policyFor(policies.rows,month);const s=settings.settings;
 const hours=hoursByArea(ops,centers,[...lists.values()].map(l=>({code:l.code,base:l.base,items:l.items})) as SapList[]);
 const wage=policy.baseSalary/policy.monthlyHours;
 // Ausentismo: el registrado en Restricciones (asistencia del mes) o, si no hay, el punto medio del rango esperado.
 const absenteeismByArea:Record<string,number|null>={};
 for(const a of config.areas){const att=config.monthAttendance.find(m=>m.area_id===a.id)?.attendance_pct??a.default_attendance_pct;absenteeismByArea[`A${a.id}`]=att<100?100-att:(s.absenteeism.min+s.absenteeism.max)/2;}
 const inModel=Object.fromEntries(config.areas.map(a=>[`A${a.id}`,a.limits_capacity&&(a.headcount??0)>0]));
 const baseAreas=buildAreas(config.areas,{absenteeismPct:3,hourlyWage:wage,efficiency:{},inModel,wageByArea:s.areaWages,absenteeismByArea});
 const priceMap=new Map(costs.map(c=>[c.material_code,c.price]));const stockMap=new Map(stock.map(x=>[x.material_code,Number(x.free_stock)]));
 const products0=buildProducts(items,hours,priceMap,stockMap,new Map(),new Set(trees.keys()),new Set(lists.keys()),s.lot.default);
 const groups=buildGroups(restrictions,items,config.areas,s.restrictionAreas);
 // Aprendizaje con todas las áreas que tienen personal (aunque no limiten), para mostrar su carga real.
 const learnAreas=baseAreas.map(a=>({...a,inModel:a.headcount>0}));
 const learned:Learned|null=programs.length?learnFromPrograms(programs,products0,learnAreas,groups,config.referenceHours,s.shifts):null;
 const {regimes,efficiency}=regimesFromLearning(learned,s.regimes);
 const lot=s.lot.learn&&learned?learned.lot:s.lot.default;
 const products=products0.map(p=>({...p,lot:p.monthlyDemand>=lot*2?lot:1}));
 const areas=buildAreas(config.areas,{absenteeismPct:3,hourlyWage:wage,efficiency,inModel,wageByArea:s.areaWages,absenteeismByArea});
 const specialOrders:SpecialOrder[]=((orders.data as any[])??[]).map(o=>({code:o.material_code,date:o.due_date,quantity:Number(o.quantity)}));
 return {month,items,restrictions,config,calendar,days:buildDays(calendar),policy,policies:policies.rows,settings:s,areas,products,groups,learned,regimes,efficiency,programs,
  specialOrders,orders:(orders.data as any[])??[],observations:((observations.data as any[])??[]) as {period:string;material_code:string;quantity:number;source:string}[],
  lists,trees,ready:{policies:policies.ready,settings:settings.ready,orders:orders.ready,observations:observations.ready}};
}
export type MpsContext=Awaited<ReturnType<typeof loadMpsContext>>;

export function makeInput(ctx:MpsContext,o:{regime:string;demandFactor:number;demandOverride?:Record<string,number>;useInitialStock:boolean;integer:boolean}):MpsInput{
 const regime=ctx.regimes.find(r=>r.key===o.regime)??ctx.regimes[0];
 return {month:ctx.month,days:ctx.days,areas:ctx.areas,products:ctx.products,groups:ctx.groups,policy:ctx.policy,regime,costs:ctx.settings.costs,referenceHours:ctx.config.referenceHours,
  demandFactor:o.demandFactor,demandOverride:o.demandOverride,specialOrders:ctx.specialOrders,useInitialStock:o.useInitialStock,integer:o.integer,wheel:ctx.settings.wheel,shifts:ctx.settings.shifts};
}
export const demandOf=(items:DemandItem[])=>Object.fromEntries(items.filter(i=>i.active).map(i=>[i.material_code,Number(i.monthly_demand)]));
