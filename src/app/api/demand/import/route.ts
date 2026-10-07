import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan, loadCodes, loadDemand } from '@/lib/planning-server';
import { readDemandExcel } from '@/lib/planning-excel';
import { diffDemand } from '@/lib/planning';
export const runtime='nodejs';

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();if(!canPlan(profile.role))return Response.json({error:'Acceso de edición denegado.'},{status:403});
 const form=await req.formData();const file=form.get('file');
 if(!(file instanceof File)||!/\.xlsx$/i.test(file.name)||file.size>10*1024*1024)throw new Error('Selecciona un Excel .xlsx de hasta 10 MB.');
 const bytes=Buffer.from(await file.arrayBuffer());const parsed=await readDemandExcel(bytes,await loadCodes(db));
 if(form.get('confirm')!=='yes'){
  const diff=diffDemand(parsed.rows,await loadDemand(db));
  return Response.json({hash:parsed.hash,sheet:parsed.sheet,errors:parsed.errors,warnings:parsed.warnings,total:parsed.rows.length,
   inserted:diff.filter(d=>d.status==='NUEVO').length,updated:diff.filter(d=>d.status==='CAMBIA').length,unchanged:diff.filter(d=>d.status==='IGUAL').length,
   changes:diff.filter(d=>d.status!=='IGUAL').slice(0,500)});
 }
 if(parsed.errors.length)throw new Error('Corrige los errores del archivo antes de cargarlo.');
 if(form.get('hash')!==parsed.hash)throw new Error('El archivo cambió. Valídalo nuevamente.');
 const long=await supabaseServer(60000);
 const result=await long.rpc('import_demand',{payload:parsed.rows.map(({source_row,...r})=>r),source_hash:parsed.hash,source_name:file.name});
 if(result.error)throw new Error(result.error.message);
 for(const p of ['/demand','/restrictions','/training'])revalidatePath(p);
 return Response.json(result.data);
}catch(e){return apiError(e);}}
