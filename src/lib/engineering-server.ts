import 'server-only';
import { requireUser } from './auth';
import { canEditBom, type EngineeringBom } from './engineering';
import { redirect } from 'next/navigation';
export async function requireEngineer(){const auth=await requireUser();if(!canEditBom(auth.profile.role))throw new Error('Acceso de edición denegado.');return auth;}
export async function requireEngineerPage(){const auth=await requireUser();if(!canEditBom(auth.profile.role))redirect('/boms');return auth;}
export async function listEngineering(){
 const {db}=await requireUser();let rows:any[]=[];
 for(let offset=0;;offset+=500){const r=await db.from('engineering_boms').select('*,product_skus!inner(*,product_models!inner(*))').order('id').range(offset,offset+499);if(r.error)throw new Error('No se pudieron consultar los BOM.');rows.push(...r.data);if(r.data.length<500)break;}
 return rows;
}
export async function loadEngineering(id:number):Promise<EngineeringBom|null>{
 const {db}=await requireUser();const b=await db.from('engineering_boms').select('*,product_skus!inner(*,product_models!inner(*))').eq('id',id).maybeSingle();if(b.error)throw new Error('No se pudo consultar el BOM.');if(!b.data)return null;
 let nodes:any[]=[];for(let offset=0;;offset+=1000){const r=await db.from('engineering_bom_nodes').select('*').eq('engineering_bom_id',id).order('sequence_order').order('id').range(offset,offset+999);if(r.error)throw new Error('No se pudieron consultar los componentes.');nodes.push(...r.data);if(r.data.length<1000)break;}
 const row=b.data,m=row.product_skus.product_models;
 return {id:row.id,revision:row.revision,reference:row.reference,design:m.catalog_name_original,referenceCode:m.reference_code??row.product_skus.sap_material_code,brand:m.brand,description:m.description,imagePath:m.image_path??row.product_skus.image_path,notes:m.notes,lifecycle:row.lifecycle,sourceType:row.source_type,sourceFile:row.source_file,nodes:nodes.map(n=>({key:n.node_code,parentKey:n.parent_node_code,externalId:n.external_component_id,name:n.component_name_original,declaredLevel:n.declared_level,quantity:n.quantity,unit:n.unit==='PENDING_REVIEW'?null:n.unit,leadTime:n.lead_time,leadTimeUnit:n.lead_time_unit,notes:n.notes,active:n.active,sequence:n.sequence_order??n.id,sourceFile:n.source_file,sourceRow:n.source_row}))};
}
