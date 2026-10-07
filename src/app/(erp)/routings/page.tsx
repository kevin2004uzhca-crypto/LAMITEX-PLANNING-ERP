import { requireUser } from '@/lib/auth';
import { canPlan, currentMonth, loadCosts, loadDemand, loadMasterImports, loadOperations, loadPlanningConfig, loadStock, loadWorkCenters } from '@/lib/planning-server';
import { RoutingsManager } from '@/components/routings-manager';

export default async function Page({searchParams}:{searchParams:Promise<{code?:string}>}){
 const {db,profile}=await requireUser();const {code}=await searchParams;const month=currentMonth();
 const [ops,centers,items,costs,stock,config,imports]=await Promise.all([loadOperations(db),loadWorkCenters(db),loadDemand(db),loadCosts(db),loadStock(db),loadPlanningConfig(db,month),loadMasterImports(db,'RUTAS')]);
 return <><p className="eyebrow">PLANIFICACIÓN / TIEMPOS DE PRODUCCIÓN</p>
  <div className="page-heading"><div><h1>Tiempos de producción</h1><p className="muted">Hojas de ruta de SAP: cada operación con su puesto de trabajo y tiempo. Escribe el código de un colchón para ver todos sus procesos y el tiempo total de elaboración.</p></div></div>
  <RoutingsManager initialCode={code??''} ops={ops} centers={centers} items={items} month={month}
   costs={costs.map(c=>({material_code:c.material_code,price:c.price}))} stock={stock.map(s=>({material_code:s.material_code,free_stock:s.free_stock,stock_date:s.stock_date}))}
   config={config} imports={imports} canEdit={canPlan(profile.role)}/></>;
}
