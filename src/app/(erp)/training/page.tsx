import { requireUser } from '@/lib/auth';
import { canPlan, fetchAll, loadCodes, loadDemand, loadRestrictions } from '@/lib/planning-server';
import { TrainingManager, type Program } from '@/components/training-manager';

export default async function Page(){
 const {db,profile}=await requireUser();
 const [programs,lines,items,restrictions,codes]=await Promise.all([
  db.from('training_programs').select('*').order('program_date',{ascending:true,nullsFirst:false}).order('id'),
  fetchAll<{program_id:number;material_code:string;description:string|null;quantity:number;source_row:number|null}>((a,b)=>db.from('training_program_lines').select('program_id,material_code,description,quantity,source_row').order('program_id').order('source_row').range(a,b) as any),
  loadDemand(db),loadRestrictions(db),loadCodes(db)]);
 if(programs.error)throw new Error(programs.error.message);
 const list:Program[]=(programs.data??[]).map(p=>({...p,lines:lines.filter(l=>l.program_id===p.id).map(l=>({...l,quantity:Number(l.quantity)}))}));
 return <><p className="eyebrow">PLANIFICACIÓN / ENTRENAMIENTO</p>
  <div className="page-heading"><div><h1>Programas de entrenamiento</h1><p className="muted">Programaciones diarias reales (las del tutor) que sirven de base para que el plan maestro se parezca a cómo se programa en planta. Aquí se ve qué tanto respeta cada programa los máximos por día.</p></div></div>
  <TrainingManager programs={list} items={items} restrictions={restrictions} codes={codes} canEdit={canPlan(profile.role)}/></>;
}
