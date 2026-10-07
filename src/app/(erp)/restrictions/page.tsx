import { requireUser } from '@/lib/auth';
import { canPlan, currentMonth, loadCodes, loadDemand, loadPlanningConfig, loadRestrictions } from '@/lib/planning-server';
import { RestrictionsManager } from '@/components/restrictions-manager';

export default async function Page({searchParams}:{searchParams:Promise<{month?:string;tab?:string}>}){
 const {db,profile}=await requireUser();const p=await searchParams;
 const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month??'')?p.month!:currentMonth();
 const [restrictions,items,codes,config]=await Promise.all([loadRestrictions(db),loadDemand(db),loadCodes(db),loadPlanningConfig(db,month)]);
 return <><p className="eyebrow">PLANIFICACIÓN / RESTRICCIONES</p>
  <div className="page-heading"><div><h1>Restricciones de producción</h1><p className="muted">Capacidad máxima diaria por tipo de colchón y panel, asistencia del personal y jornada laboral. Son la base del plan maestro: con ellas se calcula hasta dónde llega la planta sin forzar al personal y cuántas horas extra hacen falta.</p></div></div>
  <RestrictionsManager key={month} month={month} tab={p.tab??'capacity'} restrictions={restrictions} items={items} codes={codes} {...config} canEdit={canPlan(profile.role)}/></>;
}
