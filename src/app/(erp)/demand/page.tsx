import { requireUser } from '@/lib/auth';
import { canPlan, fetchAll, loadCodes, loadDemand } from '@/lib/planning-server';
import { DemandManager } from '@/components/demand-manager';

export default async function Page(){
 const {db,profile}=await requireUser();
 const [items,codes,imports,skus]=await Promise.all([
  loadDemand(db),loadCodes(db),
  db.from('demand_imports').select('id,file_name,created_at,total_rows,inserted_rows,updated_rows,unchanged_rows').order('created_at',{ascending:false}).limit(8),
  // Catálogo existente: solo lectura, para mostrar modelos que todavía no tienen demanda registrada.
  fetchAll<{sap_material_code:string|null;sap_name_original:string|null;width_cm:number|null;product_models:{catalog_name_original:string}|null}>((a,b)=>db.from('product_skus').select('sap_material_code,sap_name_original,width_cm,product_models(catalog_name_original)').eq('active',true).not('sap_material_code','is',null).order('sap_material_code').range(a,b) as any)]);
 if(imports.error)throw new Error(imports.error.message);
 const known=new Set(items.map(i=>i.material_code));const seen=new Set<string>();
 const withoutDemand=skus.filter(s=>s.sap_material_code&&!known.has(s.sap_material_code)&&!seen.has(s.sap_material_code)&&seen.add(s.sap_material_code))
  .map(s=>({code:s.sap_material_code!,description:s.sap_name_original??s.product_models?.catalog_name_original??'',size:s.width_cm===null?null:Number(s.width_cm)}));
 return <><p className="eyebrow">PLANIFICACIÓN / DEMANDA</p>
  <div className="page-heading"><div><h1>Demanda por modelo</h1><p className="muted">Promedio de venta mensual por material, con su tipo de colchón y de panel. Cada cambio queda registrado con fecha para consultar la demanda de cualquier día.</p></div></div>
  <DemandManager items={items} codes={codes} imports={imports.data??[]} withoutDemand={withoutDemand} canEdit={canPlan(profile.role)}/></>;
}
