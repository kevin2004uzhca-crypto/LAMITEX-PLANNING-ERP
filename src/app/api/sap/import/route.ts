import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { readSapExcel } from '@/lib/sap-excel';
import { checkOrigin,apiError } from '@/lib/engineering-api';
import { revalidatePath } from 'next/cache';
export const runtime='nodejs';
export async function POST(req:Request){try{
 checkOrigin(req);const {profile}=await requireUser();if(!['ADMIN','ENGINEERING'].includes(profile.role))return Response.json({error:'Acceso de importación denegado.'},{status:403});
 const form=await req.formData();const file=form.get('file');if(!(file instanceof File)||!file.name.endsWith('.xlsx')||file.size>30*1024*1024)throw new Error('Selecciona un Excel .xlsx de hasta 30 MB.');
 const bytes=Buffer.from(await file.arrayBuffer());const parsed=await readSapExcel(bytes);
 if(form.get('confirm')!=='yes')return Response.json({...parsed,rows:undefined});
 if(parsed.errors.length)throw new Error('Corrige los errores del archivo antes de importar.');
 if(form.get('hash')!==parsed.hash)throw new Error('El archivo cambió. Valida nuevamente su contenido.');
 const db=await supabaseServer(120000);const path=`sap/${parsed.hash}.xlsx`;
 const archive=await db.storage.from('imports').upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
 if(archive.error&&!['409','400'].includes(String(archive.error.statusCode)))throw new Error('No se pudo guardar el respaldo del Excel.');
 if(archive.error&&String(archive.error.statusCode)==='400'&&!/already exists|duplicate/i.test(archive.error.message))throw new Error(archive.error.message);
 const result=await db.rpc('import_sap_materials',{payload:parsed.rows,source_hash:parsed.hash,source_name:file.name,sheet_name:parsed.sheet});if(result.error)throw new Error(result.error.message);
 for(const p of ['/materials','/material-lists','/mrp','/products'])revalidatePath(p,'layout');
 return Response.json({...result.data,summary:parsed.summary});
 }catch(e){return apiError(e);}}
