import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan } from '@/lib/planning-server';

const text=(v:unknown,max=300)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max)||null:null;
const optNum=(v:unknown,label:string,{min=0,max=Infinity}={})=>{if(v===''||v===null||v===undefined)return null;const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`${label}: valor inválido.`);return n;};
const code=(v:unknown)=>{const s=typeof v==='string'?v.trim():'';if(!s||/\s/.test(s))throw new Error('Escribe el código de material SAP sin espacios.');return s;};
const date=(v:unknown,label:string)=>{if(v===''||v===null||v===undefined)return null;const s=String(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s)))throw new Error(`${label}: fecha inválida.`);return s;};

// GET: historial de cambios de un material en un módulo.
export async function GET(req:Request){try{
 const {db}=await requireUser();const u=new URL(req.url);const table=u.searchParams.get('table')??'';const material=u.searchParams.get('code')??'';
 if(!['material_costs','inventory_stock','routing_operations'].includes(table)||!material)throw new Error('Consulta inválida.');
 const r=await db.from('master_data_history').select('data,source,deleted,changed_at').eq('table_name',table).eq('material_code',material).order('changed_at',{ascending:false}).limit(60);
 if(r.error)throw new Error(r.error.message);return Response.json(r.data);
}catch(e){return apiError(e);}}

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();if(!canPlan(profile.role))return Response.json({error:'Acceso de edición denegado.'},{status:403});
 const b=await req.json();let error;const manual={last_source:'MANUAL',last_import_id:null};
 switch(b.action){
  case 'cost':{const row={description:text(b.description)??'',price:optNum(b.price,'Costo de producción'),currency:text(b.currency,10)??'USD',price_updated_at:date(b.price_updated_at,'Última modificación'),base_unit:text(b.base_unit,10),inventory_cost_pct:optNum(b.inventory_cost_pct,'% costo de inventario',{max:100}),active:b.active!==false,notes:text(b.notes,1000),...manual};
   if(!row.description)throw new Error('Escribe el texto breve del material.');const material=b.isNew?code(b.material_code):String(b.material_code);
   ({error}=b.isNew?await db.from('material_costs').insert({material_code:material,...row}):await db.from('material_costs').update(row).eq('material_code',material).select('material_code').single());break;}
  case 'stock':{const free=optNum(b.free_stock,'Libre utilización',{min:-Infinity});const row={description:text(b.description)??'',free_stock:free??0,in_transit:optNum(b.in_transit,'Stock en tránsito')??0,base_unit:text(b.base_unit,10),stock_date:date(b.stock_date,'Fecha de actualización')??new Date().toISOString().slice(0,10),active:b.active!==false,notes:text(b.notes,1000),...manual};
   if(!row.description)throw new Error('Escribe el texto breve del material.');const material=b.isNew?code(b.material_code):String(b.material_code);
   ({error}=b.isNew?await db.from('inventory_stock').insert({material_code:material,...row}):await db.from('inventory_stock').update(row).eq('material_code',material).select('material_code').single());break;}
  case 'operation':{const op=text(b.operation,10);if(!op)throw new Error('Escribe el número de operación (ej. 0010).');
   const unit=['H','MIN','S'].includes(b.standard_unit)?b.standard_unit:'H';
   const row={material_code:code(b.material_code),route_counter:text(b.route_counter,10)??'1',operation:/^\d+$/.test(op)?op.padStart(4,'0'):op,route_description:text(b.route_description),control_key:text(b.control_key,10),base_quantity:optNum(b.base_quantity,'Cantidad base')??1,op_unit:text(b.op_unit,10),standard_value:optNum(b.standard_value,'Tiempo')??0,standard_unit:unit,operation_text:text(b.operation_text,120),work_center:text(b.work_center,20),active:b.active!==false,notes:text(b.notes,1000),...manual};
   if(row.base_quantity<=0)throw new Error('La cantidad base debe ser mayor que 0.');
   if(row.work_center){const wc=await db.from('work_centers').upsert({code:row.work_center,name:row.operation_text??row.work_center},{onConflict:'code',ignoreDuplicates:true});if(wc.error)throw new Error(wc.error.message);}
   ({error}=b.id?await db.from('routing_operations').update(row).eq('id',Number(b.id)).select('id').single():await db.from('routing_operations').insert(row));
   if(error?.code==='23505')throw new Error('Ya existe esa operación para ese material y hoja de ruta.');break;}
  case 'operation-delete':({error}=await db.from('routing_operations').delete().eq('id',Number(b.id)));break;
  case 'work-center':{const c=text(b.code,20);if(!c)throw new Error('Código de puesto inválido.');
   ({error}=await db.from('work_centers').update({name:text(b.name,120)??c,area_id:b.area_id?Number(b.area_id):null,notes:text(b.notes,500)}).eq('code',c).select('code').single());break;}
  case 'inventory-pct':{const v=optNum(b.value,'% costo de inventario',{max:100});if(v===null)throw new Error('Escribe el porcentaje.');
   ({error}=await db.from('planning_settings').update({value:v}).eq('key','inventory_cost_pct').select('key').single());break;}
  default:throw new Error('Operación no reconocida.');
 }
 if(error)throw new Error(error.message);
 for(const p of ['/costs','/inventory','/routings','/demand'])revalidatePath(p);
 return Response.json({ok:true});
}catch(e){return apiError(e);}}
