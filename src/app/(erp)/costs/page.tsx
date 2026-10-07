import { requireUser } from '@/lib/auth';
import { canPlan, loadCosts, loadDemand, loadMasterImports, loadSetting, loadStock } from '@/lib/planning-server';
import { CostsManager } from '@/components/costs-manager';

export default async function Page(){
 const {db,profile}=await requireUser();
 const [costs,items,stock,pct,imports]=await Promise.all([loadCosts(db),loadDemand(db),loadStock(db),loadSetting(db,'inventory_cost_pct',1),loadMasterImports(db,'COSTOS')]);
 return <><p className="eyebrow">PLANIFICACIÓN / COSTOS</p>
  <div className="page-heading"><div><h1>Costos de producción e inventario</h1><p className="muted">Costo unitario de cada material según SAP y el costo de mantenerlo en inventario. Se cruza por código SAP con la demanda y el inventario para el plan maestro.</p></div></div>
  <CostsManager costs={costs} items={items} stock={stock.map(s=>({material_code:s.material_code,free_stock:s.free_stock}))} defaultPct={pct} imports={imports} canEdit={canPlan(profile.role)}/></>;
}
