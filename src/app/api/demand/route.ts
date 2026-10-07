import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan } from '@/lib/planning-server';
import { normalizeCode } from '@/lib/planning';

const text=(v:unknown,max=300)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const optionalNumber=(v:unknown)=>v===null||v===undefined||v===''?null:Number(v);

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();if(!canPlan(profile.role))return Response.json({error:'Acceso de edición denegado.'},{status:403});
 const body=await req.json();let error;
 if(body.action==='save'){
  const i=body.item??{};const code=text(i.material_code,40);
  const row={description:text(i.description),mattress_type:normalizeCode(i.mattress_type),panel_type:normalizeCode(i.panel_type)||'NP',size_cm:optionalNumber(i.size_cm),monthly_demand:Number(i.monthly_demand??0),active:i.active!==false,notes:text(i.notes,1000)||null,last_source:'MANUAL',last_import_id:null};
  if(!code||/\s/.test(code))throw new Error('Escribe el código de material sin espacios.');
  if(!row.description)throw new Error('Escribe la descripción del material.');
  if(!row.mattress_type)throw new Error('Elige el tipo de colchón.');
  if(row.size_cm!==null&&(!Number.isFinite(row.size_cm)||row.size_cm<=0))throw new Error('La medida debe ser un número positivo.');
  if(!Number.isFinite(row.monthly_demand)||row.monthly_demand<0)throw new Error('La demanda debe ser un número mayor o igual a 0.');
  if(body.isNew){const exists=await db.from('demand_items').select('material_code').eq('material_code',code).maybeSingle();if(exists.data)throw new Error(`El material ${code} ya existe. Edítalo desde la tabla.`);
   ({error}=await db.from('demand_items').insert({material_code:code,...row}));}
  else ({error}=await db.from('demand_items').update(row).eq('material_code',code).select('material_code').single());
  if(error?.code==='23503')throw new Error('El tipo de colchón o de panel no existe en el catálogo de letras.');
 }else if(body.action==='code'){
  const kind=body.kind==='PANEL'?'PANEL':'COLCHON';const code=normalizeCode(body.code);const name=text(body.name,80);
  if(!/^[A-Z0-9]{1,4}$/.test(code))throw new Error('La letra debe tener de 1 a 4 caracteres (A-Z, 0-9).');if(!name)throw new Error('Escribe el significado de la letra.');
  ({error}=await db.from('planning_codes').upsert({kind,code,name,active:body.active!==false,sort:Number(body.sort)||0}));
 }else throw new Error('Operación no reconocida.');
 if(error)throw new Error(error.message);
 for(const p of ['/demand','/restrictions','/training'])revalidatePath(p);
 return Response.json({ok:true});
}catch(e){return apiError(e);}}
