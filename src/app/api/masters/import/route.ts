import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan, loadCosts, loadOperations, loadStock } from '@/lib/planning-server';
import { readFirstSheet } from '@/lib/planning-excel';
import { parseCosts, parseInventory, parseRoutings } from '@/lib/masters';
export const runtime='nodejs';

const same=(a:Record<string,unknown>,b:Record<string,unknown>,keys:string[])=>keys.every(k=>(a[k]??null)===(b[k]??null)||Number(a[k])===Number(b[k])&&a[k]!==null&&b[k]!==null);

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();if(!canPlan(profile.role))return Response.json({error:'Acceso de edición denegado.'},{status:403});
 const form=await req.formData();const file=form.get('file');const kind=String(form.get('kind'));
 if(!['COSTOS','INVENTARIO','RUTAS'].includes(kind))throw new Error('Tipo de carga no reconocido.');
 if(!(file instanceof File)||!/\.xlsx$/i.test(file.name)||file.size>20*1024*1024)throw new Error('Selecciona un Excel .xlsx de hasta 20 MB.');
 const {rows,hash}=await readFirstSheet(Buffer.from(await file.arrayBuffer()),13);
 const parsed=kind==='COSTOS'?parseCosts(rows):kind==='INVENTARIO'?parseInventory(rows):parseRoutings(rows);
 const snapshot=String(form.get('snapshot')??'');
 if(kind==='INVENTARIO'&&!/^\d{4}-\d{2}-\d{2}$/.test(snapshot))throw new Error('Elige la fecha del corte de inventario.');
 if(form.get('confirm')!=='yes'){
  // Vista previa: cuántos materiales u operaciones son nuevos, cambian o quedan igual.
  let inserted=0,updated=0,removed=0;const changed:string[]=[];
  if(kind==='RUTAS'){const current=await loadOperations(db);const key=(o:any)=>`${o.material_code}|${o.route_counter}|${o.operation}`;const map=new Map(current.map(o=>[key(o),o]));const incoming=new Set(parsed.rows.map(key));const mats=new Set(parsed.rows.map(r=>r.material_code));
   for(const r of parsed.rows as any[]){const c=map.get(key(r));if(!c)inserted++;else if(!same(c as any,r,['center','route_description','control_key','base_quantity','op_unit','standard_value','standard_unit','operation_text','work_center'])||!c.active){updated++;changed.push(r.material_code);}}
   removed=current.filter(o=>mats.has(o.material_code)&&!incoming.has(key(o))).length;}
  else{const current=kind==='COSTOS'?await loadCosts(db):await loadStock(db);const map=new Map<string,any>(current.map(c=>[c.material_code,c]));
   const keys=kind==='COSTOS'?['description','center','valuation_class','material_type','article_group','base_unit','price','currency','price_updated_at']:['description','center','warehouse','base_unit','free_stock','in_transit','free_value'];
   for(const r of parsed.rows as any[]){const c=map.get(r.material_code);if(!c)inserted++;else if(!same(c,r,keys)||!c.active){updated++;changed.push(r.material_code);}}}
  return Response.json({hash,errors:parsed.errors,warnings:parsed.warnings,total:parsed.rows.length,materials:new Set(parsed.rows.map(r=>r.material_code)).size,inserted,updated,removed,unchanged:parsed.rows.length-inserted-updated,changed:[...new Set(changed)].slice(0,300)});
 }
 if(parsed.errors.length)throw new Error('Corrige los errores del archivo antes de cargarlo.');
 if(form.get('hash')!==hash)throw new Error('El archivo cambió. Valídalo nuevamente.');
 const long=await supabaseServer(120000);
 const result=kind==='COSTOS'?await long.rpc('import_material_costs',{payload:parsed.rows,source_hash:hash,source_name:file.name})
  :kind==='INVENTARIO'?await long.rpc('import_inventory',{payload:parsed.rows,source_hash:hash,source_name:file.name,snapshot})
  :await long.rpc('import_routings',{payload:parsed.rows,source_hash:hash,source_name:file.name});
 if(result.error)throw new Error(result.error.message);
 for(const p of ['/costs','/inventory','/routings','/demand'])revalidatePath(p);
 return Response.json(result.data);
}catch(e){return apiError(e);}}
