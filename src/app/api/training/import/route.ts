import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan } from '@/lib/planning-server';
import { readTrainingExcel } from '@/lib/planning-excel';
import { WEEKDAYS } from '@/lib/planning';
export const runtime='nodejs';

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();if(!canPlan(profile.role))return Response.json({error:'Acceso de edición denegado.'},{status:403});
 const form=await req.formData();const file=form.get('file');
 if(!(file instanceof File)||!/\.xlsx$/i.test(file.name)||file.size>10*1024*1024)throw new Error('Selecciona un Excel .xlsx de hasta 10 MB.');
 const parsed=await readTrainingExcel(Buffer.from(await file.arrayBuffer()));
 if(form.get('confirm')!=='yes'){
  const previous=await db.from('training_programs').select('id,name,created_at').eq('file_hash',parsed.hash);
  return Response.json({hash:parsed.hash,alreadyLoaded:previous.data??[],programs:parsed.programs.map(p=>({...p,total:p.lines.reduce((s,l)=>s+l.quantity,0)}))});
 }
 if(form.get('hash')!==parsed.hash)throw new Error('El archivo cambió. Valídalo nuevamente.');
 // El usuario confirma qué hojas guardar y puede corregir nombre, día y fecha de cada una.
 const choices=JSON.parse(String(form.get('choices')??'[]')) as {sheet:string;include:boolean;name:string;weekday:string;program_date:string}[];
 const payload=choices.filter(c=>c.include).map(c=>{const p=parsed.programs.find(x=>x.sheet===c.sheet);if(!p)throw new Error(`La hoja ${c.sheet} no existe en el archivo.`);
  if(p.errors.length)throw new Error(`La hoja ${c.sheet} tiene errores; desmárcala o corrige el archivo.`);
  if(!WEEKDAYS.includes(c.weekday as any))throw new Error(`Elige el día de la hoja ${c.sheet}.`);
  if(c.program_date&&!/^\d{4}-\d{2}-\d{2}$/.test(c.program_date))throw new Error(`Fecha inválida en la hoja ${c.sheet}.`);
  return {name:String(c.name||p.name).trim().slice(0,120),weekday:c.weekday,program_date:c.program_date||null,sheet:p.sheet,lines:p.lines};});
 if(!payload.length)throw new Error('Marca al menos una hoja para guardar.');
 const result=await db.rpc('import_training_programs',{payload,source_hash:parsed.hash,source_name:file.name});
 if(result.error)throw new Error(result.error.message);
 revalidatePath('/training');
 return Response.json(result.data);
}catch(e){return apiError(e);}}
