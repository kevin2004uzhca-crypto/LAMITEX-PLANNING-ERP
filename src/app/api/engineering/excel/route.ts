import { createHash } from 'node:crypto';
import { requireEngineer,listEngineering,loadEngineering } from '@/lib/engineering-server';
import { writeEngineeringWorkbook,readEngineeringWorkbook } from '@/lib/engineering-excel';
import { checkOrigin,apiError,persistEngineering } from '@/lib/engineering-api';
import type { EngineeringBom } from '@/lib/engineering';
export const runtime='nodejs';
export async function GET(request:Request){try{
 await requireEngineer();const p=new URL(request.url).searchParams;let boms:EngineeringBom[]=[];
 if(p.get('template')!=='1'){
  const ids=p.has('id')?[Number(p.get('id'))]:(await listEngineering()).map(b=>b.id);
  for(let i=0;i<ids.length;i+=10){const group=await Promise.all(ids.slice(i,i+10).map(loadEngineering));boms.push(...group.filter((b):b is EngineeringBom=>b!==null));}
 }
 const bytes=await writeEngineeringWorkbook(boms);
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${p.get('template')==='1'?'LAMITEX_BOM_PLANTILLA':'LAMITEX_BOM_MASTER'}.xlsx"`,'Cache-Control':'private, no-store'}});
 }catch(e){return apiError(e);}}
export async function POST(request:Request){try{
 checkOrigin(request);const {db,user}=await requireEngineer();const form=await request.formData();const file=form.get('file');
 if(!(file instanceof File)||file.size>8*1024*1024||!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('Selecciona un Excel .xlsx de hasta 8 MB.');
 const bytes=Buffer.from(await file.arrayBuffer());const hash=createHash('sha256').update(bytes).digest('hex');
 const parsed=await readEngineeringWorkbook(bytes,file.name);const existing=await listEngineering();
 if(form.get('mode')!=='copy')for(const b of parsed.boms){const match=existing.find(r=>r.reference===b.reference&&r.product_skus.product_models.catalog_name_original===b.design);if(match){b.id=match.id;b.revision=match.revision;}}
 const warnings=parsed.validation.reduce((n,v)=>n+v.issues.filter(i=>i.severity==='WARNING').length,0);
 const errors=parsed.errors.length+parsed.validation.reduce((n,v)=>n+v.issues.filter(i=>i.severity==='ERROR').length,0);
 if(form.get('phase')==='save'){
  if(errors)throw new Error('El archivo contiene errores críticos.');
  const expected=JSON.parse(String(form.get('expected')??'[]')) as {id:number|null;revision:number|null}[];
  if(expected.length!==parsed.boms.length||parsed.boms.some((b,i)=>b.id!==expected[i].id||b.revision!==expected[i].revision))throw new Error('La base cambió desde la previsualización. Vuelve a validar el archivo.');
  if(form.get('hash')!==hash)throw new Error('El archivo cambió. Vuelve a validar.');
  if(form.get('acknowledged')!=='true')throw new Error('Confirma la revisión de la carga.');
  const path=`engineering/${user.id}/${hash}.xlsx`;const archive=await db.storage.from('imports').upload(path,bytes,{contentType:file.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
  if(archive.error&&!archive.error.message.toLowerCase().includes('already exists')&&!archive.error.message.toLowerCase().includes('duplicate'))throw new Error('No se pudo archivar el Excel original.');
  const saved=await persistEngineering(parsed.boms,true);return Response.json({saved});
 }
 return Response.json({...parsed,hash,summary:{designs:new Set(parsed.boms.map(b=>b.design)).size,boms:parsed.boms.length,nodes:parsed.boms.reduce((n,b)=>n+b.nodes.length,0),warnings,errors}});
 }catch(e){return apiError(e);}}
