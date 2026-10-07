import { requireUser } from '@/lib/auth';
import { canPlan, currentMonth } from '@/lib/planning-server';
import { loadMpsContext } from '@/lib/mps-server';
import { forecastAll } from '@/lib/forecast';
import { MpsManager } from '@/components/mps-manager';

export default async function Page({searchParams}:{searchParams:Promise<{month?:string;tab?:string;run?:string}>}){
 const {db,profile}=await requireUser();const p=await searchParams;
 const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month??'')?p.month!:currentMonth();
 const ctx=await loadMpsContext(db,month);
 const [runs,saved,versions]=await Promise.all([
  db.from('mps_runs').select('id,name,month,scenario,regime,classification,status,created_at').order('created_at',{ascending:false}).limit(20),
  p.run?db.from('mps_runs').select('*').eq('id',p.run).maybeSingle():Promise.resolve(null),
  db.from('mps_learning_versions').select('id,programs,created_at,notes').order('created_at',{ascending:false}).limit(10)]);
 const forecast=forecastAll(ctx.items,ctx.observations.map(o=>({...o,period:String(o.period).slice(0,7)})),ctx.settings.demandVariation);
 const periods=[...new Set(ctx.observations.map(o=>String(o.period).slice(0,7)))].sort();
 return <><p className="eyebrow">PLANIFICACIÓN / PLAN MAESTRO</p>
  <div className="page-heading"><div><h1>Plan maestro de producción</h1><p className="muted">Programa cuántos colchones de cada código SAP producir cada día del mes minimizando las horas extra, con la demanda, las restricciones, los tiempos de cada modelo, el personal y lo aprendido de los programas reales. De aquí sale el requerimiento de materiales.</p></div></div>
  <MpsManager key={month+(p.run??'')} month={month} tab={p.tab??'plan'} canEdit={canPlan(profile.role)} ready={{...ctx.ready,runs:!runs.error}}
   products={ctx.products.map(x=>({code:x.code,description:x.description,mattressType:x.mattressType,panelType:x.panelType,size:x.size,demand:x.monthlyDemand,lot:x.lot,hoursSource:x.hoursSource,hours:x.hours,hasTree:x.hasEngineeringBom,hasSap:x.hasSapList,cost:x.unitCost,stock:x.stock}))}
   areas={ctx.areas} groups={ctx.groups.map(g=>({key:g.key,name:g.name,maxPerDay:g.maxPerDay,models:g.codes.length,areaKey:g.areaKey}))} policy={ctx.policy} policies={ctx.policies} regimes={ctx.regimes} settings={ctx.settings}
   learned={ctx.learned} programs={ctx.programs.map(x=>({id:x.id,name:x.name,weekday:x.weekday,total:x.lines.reduce((s,l)=>s+l.quantity,0),models:x.lines.length}))} referenceHours={ctx.config.referenceHours}
   workingDays={ctx.days.filter(d=>d.working).length} saturdays={ctx.days.filter(d=>d.weekday===6&&!d.working).length}
   forecast={[...forecast].map(([code,f])=>({code,...f}))} periods={periods} orders={ctx.orders}
   runs={runs.error?[]:runs.data??[]} saved={saved&&!saved.error?saved.data:null} versions={versions.error?[]:versions.data??[]}/></>;
}
