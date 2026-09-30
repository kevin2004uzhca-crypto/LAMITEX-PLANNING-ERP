import { createHash } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import pilot from '@/data/pilot.json';
export async function POST(request: Request) {
  const { db, user, profile } = await requireUser();
  if(!['ADMIN','ENGINEERING'].includes(profile.role)) return Response.json({error:'Tu rol no permite archivar fuentes.'},{status:403});
  if(request.headers.get('origin') !== new URL(request.url).origin) return Response.json({error:'Origen no permitido.'},{status:403});
  const form=await request.formData();const file=form.get('file');
  if(!(file instanceof File)||file.size>50*1024*1024) return Response.json({error:'Selecciona un archivo original de hasta 50 MB.'},{status:400});
  const expected=pilot.sources.find(s=>s.file===file.name);
  if(!expected)return Response.json({error:'Esta iteración admite únicamente las cuatro fuentes del piloto.'},{status:400});
  const bytes=Buffer.from(await file.arrayBuffer());const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==expected.sha256)return Response.json({error:'El archivo difiere de la fuente auditada. Requiere una nueva revisión antes de importarlo.'},{status:400});
  const objectPath=`${hash}/${file.name}`;
  const {data:existing,error:readError}=await db.from('imports').select('id').eq('import_type','SOURCE_ARCHIVE').eq('file_hash',hash).eq('status','STAGED').limit(1);
  if(readError)return Response.json({error:'No se pudo comprobar el historial de importaciones.'},{status:503});
  if(existing?.length)return Response.json({message:'Fuente idéntica ya archivada. No se duplicó.'});
  const upload=await db.storage.from('imports').upload(objectPath,bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
  if(upload.error && !['409','400'].includes(String(upload.error.statusCode)))return Response.json({error:'No se pudo archivar el archivo en Storage. Revisa el estado del sistema.'},{status:503});
  // A prior upload may exist after a failed metadata insert. Verify its bytes before recovery.
  if(upload.error){const check=await db.storage.from('imports').download(objectPath);if(check.error||!check.data||createHash('sha256').update(Buffer.from(await check.data.arrayBuffer())).digest('hex')!==hash)return Response.json({error:'No se pudo verificar el archivo existente.'},{status:409});}
  const {error}=await db.from('imports').insert({import_type:'SOURCE_ARCHIVE',file_name:file.name,file_hash:hash,source_system:'EXCEL',imported_by:user.id,status:'STAGED',notes:JSON.stringify({bucket:'imports',path:objectPath,immutable:true})});
  if(error)return Response.json({error:'Archivo archivado, pero falta registrar su metadata. Reintenta para completar el registro.'},{status:503});
  return Response.json({message:'Fuente original archivada y verificada por SHA-256.'});
}
