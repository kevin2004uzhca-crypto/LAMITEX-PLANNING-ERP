import { requireUser } from '@/lib/auth';
import { canPlan, loadCodes, loadCosts, loadDemand, loadMasterImports, loadRestrictions, loadSetting, loadStock } from '@/lib/planning-server';
import { InventoryManager } from '@/components/inventory-manager';

export default async function Page(){
 const {db,profile}=await requireUser();
 const [stock,items,costs,pct,imports,codes,restrictions]=await Promise.all([loadStock(db),loadDemand(db),loadCosts(db),loadSetting(db,'inventory_cost_pct',1),loadMasterImports(db,'INVENTARIO'),loadCodes(db),loadRestrictions(db)]);
 return <><p className="eyebrow">PLANIFICACIÓN / INVENTARIO</p>
  <div className="page-heading"><div><h1>Inventario inicial</h1><p className="muted">Stock en libre utilización por material (Kardex SAP) con su fecha de actualización. Es el punto de partida del plan maestro: lo que ya hay en bodega se descuenta de lo que se debe producir.</p></div></div>
  <InventoryManager stock={stock} items={items} costs={costs.map(c=>({material_code:c.material_code,price:c.price,inventory_cost_pct:c.inventory_cost_pct}))} defaultPct={pct} imports={imports} canEdit={canPlan(profile.role)} codes={codes} restrictions={restrictions}/></>;
}
