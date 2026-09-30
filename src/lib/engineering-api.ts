import 'server-only';
import { requireEngineer } from './engineering-server';
import { validateEngineering,type EngineeringBom } from './engineering';
import { revalidatePath } from 'next/cache';
export function checkOrigin(request:Request){if(request.headers.get('origin')!==new URL(request.url).origin)throw new Error('Origen no autorizado.');}
export async function persistEngineering(boms:EngineeringBom[],acknowledged:boolean){
 const {db}=await requireEngineer();if(!Array.isArray(boms)||!boms.length||boms.length>200)throw new Error('Seleccione entre 1 y 200 BOM.');
 const checks=boms.map(validateEngineering);if(checks.some(c=>!c.valid))throw new Error('Hay errores críticos. Corrige la estructura antes de guardar.');
 if(!acknowledged&&checks.some(c=>c.issues.some(i=>i.severity==='WARNING')))throw new Error('Revise y acepte las advertencias antes de guardar.');
 const result=await db.rpc('save_engineering_boms',{payload:boms});if(result.error)throw new Error(result.error.message);
 for(const path of ['/boms','/admin/boms','/pilot','/products','/'])revalidatePath(path,'layout');
 return result.data as {id:number;revision:number;reference:string}[];
}
export const apiError=(e:unknown)=>{const message=e instanceof Error?e.message:'No se pudo completar la operación.';return Response.json({error:message==='NEXT_REDIRECT'?'Inicia sesión para continuar.':message},{status:message==='NEXT_REDIRECT'?401:message==='Acceso de edición denegado.'?403:400});};
