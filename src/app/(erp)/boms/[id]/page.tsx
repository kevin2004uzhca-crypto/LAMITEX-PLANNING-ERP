import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { loadEngineering } from '@/lib/engineering-server';
import { canEditBom } from '@/lib/engineering';
import { EngineeringView } from '@/components/engineering-view';
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^\d+$/.test(id))notFound();const {db,profile}=await requireUser();const bom=await loadEngineering(Number(id));if(!bom)notFound();
 const row=await db.from('engineering_boms').select('product_sku_id').eq('id',id).single();if(row.error)throw new Error('No se pudo consultar el SKU.');
 const headers=await db.from('sap_bom_headers').select('*').eq('product_sku_id',row.data.product_sku_id);if(headers.error)throw new Error('No se pudieron consultar las listas SAP.');
 const sap=await Promise.all(headers.data.map(async h=>{let items:any[]=[];for(let offset=0;;offset+=1000){const r=await db.from('sap_bom_items').select('*').eq('sap_bom_header_id',h.id).order('position').range(offset,offset+999);if(r.error)throw new Error('Error al consultar materiales.');items.push(...r.data);if(r.data.length<1000)break;}return {...h,items};}));
 const history=await db.from('engineering_bom_history').select('revision,recorded_at').eq('engineering_bom_id',id).order('revision',{ascending:false}).limit(50);
 return <EngineeringView bom={bom} canEdit={canEditBom(profile.role)} sap={sap} history={history.data??[]}/>;
}
