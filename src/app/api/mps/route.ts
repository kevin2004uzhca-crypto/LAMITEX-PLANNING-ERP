import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan, loadStock } from '@/lib/planning-server';
import { getHighs, normalizeShifts, loadMaterials, loadMpsContext, loadSapLists, loadTrees, makeInput, type MpsContext } from '@/lib/mps-server';
import { monteCarlo, solveMps, type MpsResult } from '@/lib/mps';
import { forecastAll, rng } from '@/lib/forecast';
import { calculateNetMrp } from '@/lib/mrp-net';

export const maxDuration=300;
const month=(v:unknown)=>{const s=String(v??'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw new Error('Mes inválido.');return s;};
const text=(v:unknown,max=300)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const num=(v:unknown,min:number,max:number,label:string)=>{const n=Number(v);if(v===''||v===null||v===undefined||!Number.isFinite(n)||n<min||n>max)throw new Error(`${label}: valor entre ${min} y ${max}.`);return n;};
const SCENARIOS=['BAJA','BASE','ALTA','PRONOSTICO'];

/** Demanda del escenario: baja/alta = base ± variación; pronóstico = método elegido por código con la historia registrada. */
function scenarioDemand(ctx:MpsContext,scenario:string){
 const v=ctx.settings.demandVariation/100;
 if(scenario==='PRONOSTICO'){const f=forecastAll(ctx.items,ctx.observations.map(o=>({...o,period:String(o.period).slice(0,7)})),ctx.settings.demandVariation);return {factor:1,override:Object.fromEntries([...f].map(([k,x])=>[k,x.point]))};}
 return {factor:scenario==='BAJA'?1-v:scenario==='ALTA'?1+v:1,override:undefined};
}
const summary=(r:MpsResult)=>({classification:r.classification,kpis:r.kpis,areas:r.areas.map(a=>({name:a.name,overtimeHours:a.overtimeHours,saturdayHours:a.saturdayHours,overtimeUse:a.overtimeUse,saturdayUse:a.saturdayUse,requiredHours:a.requiredHours})),groups:r.groups.map(g=>({name:g.name,forced:g.forced,forcedDays:g.forcedDays}))});

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();const b=await req.json();const edit=canPlan(profile.role);
 const need=()=>{if(!edit)throw new Error('Acceso de edición denegado.');};
 switch(b.action){
  case 'run':{const m=month(b.month);const ctx=await loadMpsContext(db,m);const highs=await getHighs();const scenario=SCENARIOS.includes(b.scenario)?b.scenario:'BASE';const d=scenarioDemand(ctx,scenario);
   const result=solveMps(highs,makeInput(ctx,{regime:String(b.regime??'NORMAL'),demandFactor:d.factor,demandOverride:d.override,useInitialStock:b.useInitialStock===true,integer:b.exact===true}),{timeLimit:b.exact?120:60});
   return Response.json({result,scenario,regime:b.regime,policy:ctx.policy,learnedPrograms:ctx.learned?.programs??0});}
  case 'matrix':{const m=month(b.month);const ctx=await loadMpsContext(db,m);const highs=await getHighs();const out=[];
   for(const scenario of ['BAJA','BASE','ALTA'])for(const r of ctx.regimes){const d=scenarioDemand(ctx,scenario);
    const res=solveMps(highs,makeInput(ctx,{regime:r.key,demandFactor:d.factor,useInitialStock:b.useInitialStock===true,integer:false}),{timeLimit:30});out.push({scenario,regime:r.key,...summary(res)});}
   return Response.json({matrix:out,variation:ctx.settings.demandVariation});}
  case 'montecarlo':{const m=month(b.month);const ctx=await loadMpsContext(db,m);const highs=await getHighs();
   const runs=num(b.runs??40,5,200,'Corridas');const variation=num(b.variationPct??ctx.settings.demandVariation,0,100,'Variación');
   const min=num(b.absenteeismMin??ctx.settings.absenteeism.min,0,50,'Ausentismo mínimo'),max=num(b.absenteeismMax??ctx.settings.absenteeism.max,min,60,'Ausentismo máximo');
   const s=monteCarlo(highs,makeInput(ctx,{regime:String(b.regime??'NORMAL'),demandFactor:1,useInitialStock:b.useInitialStock===true,integer:false}),{runs,variationPct:variation,absenteeismMin:min,absenteeismMax:max,random:rng(Number(b.seed)||2026)});
   return Response.json({montecarlo:s});}
  case 'mrp':{const m=month(b.month);const plan=Array.isArray(b.plan)?b.plan.slice(0,5000).map((p:any)=>({code:String(p.code),description:String(p.description??''),weekly:(p.weekly as number[]).map(Number)})):[];
   const weeks=(b.weeks as string[]).map(String);const ctx=await loadMpsContext(db,m);const [materials,stock]=await Promise.all([loadMaterials(db),loadStock(db)]);
   const maps=await db.from('bom_node_material_map').select('node_id,material_code');const nodeMap=new Map<number,string>(maps.error?[]:(maps.data??[]).map(x=>[Number(x.node_id),x.material_code]));
   const mrp=calculateNetMrp(plan,weeks,ctx.trees,ctx.lists,materials,new Map(stock.map(s=>[s.material_code,{free:Number(s.free_stock),transit:Number(s.in_transit)}])),nodeMap,{useTransit:b.useTransit!==false});
   return Response.json({mrp});}
  case 'save':{need();const m=month(b.month);const name=text(b.name,120)||`Plan ${m} ${b.scenario} ${b.regime}`;
   const r=await db.from('mps_runs').insert({name,month:`${m}-01`,scenario:text(b.scenario,20),regime:text(b.regime,20),classification:b.result?.classification,inputs:b.inputs??{},result:b.result,mrp:b.mrp??null}).select('id').single();
   if(r.error)throw new Error(r.error.message);revalidatePath('/mps');return Response.json({id:r.data.id});}
  case 'approve':{need();const r=await db.from('mps_runs').update({status:'APROBADO',approved_by:(await db.auth.getUser()).data.user?.id,approved_at:new Date().toISOString()}).eq('id',String(b.id)).select('id').single();if(r.error)throw new Error(r.error.message);break;}
  case 'policy':{need();const row={valid_from:text(b.valid_from,10),base_salary:num(b.baseSalary,1,100000,'Sueldo básico'),monthly_hours:num(b.monthlyHours,1,744,'Horas del mes'),overtime_surcharge_pct:num(b.overtimeSurchargePct,0,500,'Recargo suplementarias'),
    extraordinary_surcharge_pct:num(b.extraordinarySurchargePct,0,500,'Recargo extraordinarias'),max_overtime_day:num(b.maxOvertimeDay,0,12,'Máximo de horas extra por día'),max_overtime_week:num(b.maxOvertimeWeek,0,60,'Máximo de horas extra por semana'),
    saturday_enabled:b.saturdayEnabled===true,saturday_max_hours:num(b.saturdayMaxHours,0,12,'Horas máximas en sábado'),notes:text(b.notes,500)||null};
   if(!/^\d{4}-\d{2}-\d{2}$/.test(row.valid_from))throw new Error('Indica la fecha desde la que rige la política.');
   const r=await db.from('labor_policies').upsert(row,{onConflict:'valid_from'});if(r.error)throw new Error(r.error.message);break;}
  case 'settings':{need();const allowed=['costs','regimes','absenteeism','demand_variation','wheel','lot','area_wages','restriction_areas','shifts'];if(!allowed.includes(b.key))throw new Error('Parámetro no reconocido.');
   let value=b.value;if(b.key==='shifts'){const sh=normalizeShifts(b.value);if(!sh.some(x=>x.active))throw new Error('Debe quedar al menos un turno activo.');value=sh;}
   const r=await db.from('mps_settings').upsert({key:b.key,value,updated_at:new Date().toISOString()}).select('key').single();if(r.error)throw new Error(r.error.message);break;}
  case 'order':{need();const row={material_code:text(b.material_code,40).toUpperCase(),due_date:text(b.due_date,10),quantity:num(b.quantity,1,1e6,'Cantidad'),customer:text(b.customer,120)||null,notes:text(b.notes,300)||null};
   if(!row.material_code||/\s/.test(row.material_code))throw new Error('Código SAP inválido.');if(!/^\d{4}-\d{2}-\d{2}$/.test(row.due_date))throw new Error('Fecha inválida.');
   const r=await db.from('mps_special_orders').insert(row);if(r.error)throw new Error(r.error.message);break;}
  case 'order-close':{need();const r=await db.from('mps_special_orders').update({status:'CERRADO'}).eq('id',Number(b.id));if(r.error)throw new Error(r.error.message);break;}
  case 'observe':{need();const m=month(b.month);const r=await db.rpc('record_demand_observation',{target:`${m}-01`});if(r.error)throw new Error(r.error.message);return Response.json({ok:true,rows:r.data});}
  case 'learn-save':{need();const ctx=await loadMpsContext(db,month(b.month));if(!ctx.learned)throw new Error('No hay programas de entrenamiento cargados.');
   const r=await db.from('mps_learning_versions').insert({programs:ctx.learned.programs,learned:ctx.learned,regimes:ctx.regimes,notes:text(b.notes,300)||null});if(r.error)throw new Error(r.error.message);break;}
  case 'tree':{const code=text(b.code,40);const [trees,lists]=await Promise.all([loadTrees(db),loadSapLists(db)]);
   const tree=trees.get(code)??null;const list=lists.get(code)??null;
   const maps=tree?await db.from('bom_node_material_map').select('node_id,material_code').in('node_id',tree.nodes.map(n=>n.id)):null;
   return Response.json({tree,list,maps:maps&&!maps.error?maps.data:[],mapsReady:!!maps&&!maps.error});}
  case 'node-map':{need();const row={node_id:Number(b.node_id),material_code:text(b.material_code,40)};if(!row.material_code)throw new Error('Elige el material SAP.');
   const r=await db.from('bom_node_material_map').upsert(row);if(r.error)throw new Error(r.error.message);break;}
  case 'node-map-delete':{need();const r=await db.from('bom_node_material_map').delete().eq('node_id',Number(b.node_id));if(r.error)throw new Error(r.error.message);break;}
  default:throw new Error('Operación no reconocida.');
 }
 revalidatePath('/mps');revalidatePath('/restrictions');
 return Response.json({ok:true});
}catch(e){return apiError(e);}}
