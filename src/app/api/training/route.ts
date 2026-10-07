import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan } from '@/lib/planning-server';
import { WEEKDAYS } from '@/lib/planning';

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();if(!canPlan(profile.role))return Response.json({error:'Acceso de edición denegado.'},{status:403});
 const b=await req.json();const id=Number(b.id);if(!Number.isInteger(id))throw new Error('Programa inválido.');let error;
 if(b.action==='update'){
  const name=typeof b.name==='string'?b.name.trim().slice(0,120):'';if(!name)throw new Error('Escribe el nombre del programa.');
  if(!WEEKDAYS.includes(b.weekday))throw new Error('Elige el día.');if(b.program_date&&!/^\d{4}-\d{2}-\d{2}$/.test(b.program_date))throw new Error('Fecha inválida.');
  ({error}=await db.from('training_programs').update({name,weekday:b.weekday,program_date:b.program_date||null,notes:typeof b.notes==='string'?b.notes.trim().slice(0,1000)||null:null}).eq('id',id).select('id').single());
 }else if(b.action==='delete')({error}=await db.from('training_programs').delete().eq('id',id));
 else throw new Error('Operación no reconocida.');
 if(error)throw new Error(error.message);
 revalidatePath('/training');return Response.json({ok:true});
}catch(e){return apiError(e);}}
