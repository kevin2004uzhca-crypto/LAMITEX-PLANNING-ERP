import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { requireEngineer } from '@/lib/engineering-server';
import { checkOrigin,apiError } from '@/lib/engineering-api';
export async function GET(request:Request){try{const {db}=await requireUser();const path=new URL(request.url).searchParams.get('path');if(!path)throw new Error('Imagen no indicada.');const r=await db.storage.from('product-images').download(path);if(r.error)throw new Error('Imagen no disponible.');return new Response(r.data,{headers:{'Content-Type':r.data.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const {db,user}=await requireEngineer();const form=await request.formData();const file=form.get('file');if(!(file instanceof File)||file.size>5*1024*1024)throw new Error('Imagen de hasta 5 MB.');
 const bytes=Buffer.from(await file.arrayBuffer());let ext='';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')ext='webp';if(!ext)throw new Error('Usa PNG, JPEG o WebP.');
 const path=`engineering/${user.id}/${randomUUID()}.${ext}`;const r=await db.storage.from('product-images').upload(path,bytes,{contentType:`image/${ext==='jpg'?'jpeg':ext}`,upsert:false});if(r.error)throw new Error('No se pudo subir la imagen.');return Response.json({path});
 }catch(e){return apiError(e);}}
