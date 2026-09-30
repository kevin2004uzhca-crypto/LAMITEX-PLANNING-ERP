export type MrpProduct={id:number;name:string;code:string|null};
export type MrpHeader={id:number;code:string;center:string;alternative:string;base:number|null;unit:string|null;active:boolean;items:MrpItem[]};
export type MrpItem={id:number;code:string;description:string|null;quantity:number|null;unit:string|null;sourceRow:number|null;position:string|null};
export type MrpMaterial={id:number;code:string;description:string|null;family:string|null;classification:string|null;active:boolean;purchaseUnit:string|null;conversionFromUnit:string|null;unitsPerPurchase:number|null;conversionConfirmed:boolean};
export type MrpInput={productId:number;headerId:number|null;quantity:number};
export type MrpAlert={severity:'ERROR'|'WARNING'|'INFO';code:string;message:string;productId?:number;materialCode?:string};
export type MrpContribution={productId:number;productName:string;productCode:string;headerId:number;center:string;alternative:string;position:string|null;itemId:number;sourceRow:number|null;planned:number;plannedUnit:string;original:number|null;base:number;unitUsage:number|null;gross:number;originalRequirement:number|null;included:boolean};
export type MrpResultRow={code:string;description:string;unit:string;family:string|null;classification:string|null;gross:number;negative:number;consumers:number;contributions:MrpContribution[];purchaseUnit:string|null;purchaseQuantity:number|null;purchasePacks:number|null;conversionStatus:string};
export type MrpResult={status:'READY'|'WITH_WARNINGS'|'INCOMPLETE';rows:MrpResultRow[];alerts:MrpAlert[];summary:{products:number;plannedByUnit:Record<string,number>;materials:number;families:number;shared:number};scope:string};
export function calculateGrossMrp(plan:MrpInput[],products:MrpProduct[],headers:MrpHeader[],materials:MrpMaterial[],knownUnits:string[]):MrpResult{
 const alerts:MrpAlert[]=[];const groups=new Map<string,MrpResultRow>();const productMap=new Map(products.map(p=>[p.id,p]));const headerMap=new Map(headers.map(h=>[h.id,h]));const materialMap=new Map(materials.map(m=>[m.code,m]));const selectedProducts=new Set<number>();const plannedByUnit:Record<string,number>={};
 const alert=(a:MrpAlert)=>{if(!alerts.some(x=>x.code===a.code&&x.productId===a.productId&&x.materialCode===a.materialCode&&x.message===a.message))alerts.push(a);};
 if(!plan.length||plan.length>100)throw new Error('Programa entre 1 y 100 productos.');
 for(const line of plan){
  const p=productMap.get(line.productId);if(!p)throw new Error('Hay un producto inexistente en el plan.');
  if(selectedProducts.has(p.id))throw new Error(`${p.name}: el producto está repetido. Define una sola alternativa por producto en esta ejecución.`);selectedProducts.add(p.id);
  if(!Number.isFinite(line.quantity)||line.quantity<=0||line.quantity>1e9)throw new Error(`${p.name}: cantidad de producción inválida.`);
  if(!p.code)throw new Error(`${p.name}: producto sin código SAP. Revisa la relación en Listas SAP.`);
  const options=headers.filter(h=>h.code===p.code&&h.active);const h=line.headerId===null?undefined:headerMap.get(line.headerId);
  if(!options.length)throw new Error(`${p.name}: el código ${p.code} no tiene BOM SAP activo.`);
  if(!h||!h.active||h.code!==p.code)throw new Error(`${p.name}: selecciona explícitamente su centro y alternativa SAP.`);
  if(h.base===null||!Number.isFinite(h.base)||h.base<=0||!h.unit)throw new Error(`${p.name}: cantidad o unidad base no informada o inválida.`);
  if(!h.items.length)throw new Error(`${p.name}: la lista SAP no contiene posiciones.`);
  plannedByUnit[h.unit]=(plannedByUnit[h.unit]??0)+line.quantity;
  for(const i of h.items){
   const m=materialMap.get(i.code);const unit=i.unit??'';const key=JSON.stringify([i.code,unit]);
   let r=groups.get(key);if(!r){r={code:i.code,description:i.description??m?.description??'Descripción no informada',unit:unit||'No informada',family:m?.family??null,classification:m?.classification??null,gross:0,negative:0,consumers:0,contributions:[],purchaseUnit:m?.purchaseUnit??null,purchaseQuantity:null,purchasePacks:null,conversionStatus:'Conversión de compra pendiente'};groups.set(key,r);}
   const valid=!!i.code&&!!i.unit&&i.quantity!==null&&Number.isFinite(i.quantity)&&!!m;
   const factor=i.quantity===null||!Number.isFinite(i.quantity)?null:i.quantity/h.base;const required=factor===null?null:factor*line.quantity;
   const included=valid&&i.quantity!>=0;const gross=included?required!:0;r.gross+=gross;if(valid&&i.quantity!<0)r.negative+=required!;
   r.contributions.push({productId:p.id,productName:p.name,productCode:p.code,headerId:h.id,center:h.center,alternative:h.alternative,position:i.position,itemId:i.id,sourceRow:i.sourceRow,planned:line.quantity,plannedUnit:h.unit,original:i.quantity,base:h.base,unitUsage:factor,gross,originalRequirement:required,included});
   if(!valid)alert({severity:'ERROR',code:'INVALID_ITEM',materialCode:i.code,productId:p.id,message:`${i.code||'Sin código'}: falta código, cantidad válida, unidad o registro en el maestro. Posición excluida del total.`});
   if(valid&&i.quantity!<0)alert({severity:'WARNING',code:'NEGATIVE',materialCode:i.code,message:`${i.code}: cantidad negativa; requiere clasificación. Se conserva aparte y no reduce necesidades positivas.`});
   if(i.unit&&!knownUnits.includes(i.unit))alert({severity:'WARNING',code:'UNKNOWN_UNIT',materialCode:i.code,message:`${i.code}: unidad ${i.unit} pendiente de confirmar; se conserva sin conversión.`});
   if(!m?.family)alert({severity:'WARNING',code:'MISSING_FAMILY',materialCode:i.code,message:`${i.code}: familia pendiente; el consumo participa en el cálculo.`});
   if(!m?.classification)alert({severity:'WARNING',code:'MISSING_CLASSIFICATION',materialCode:i.code,message:`${i.code}: clasificación MRP pendiente; el consumo participa en el cálculo.`});
   if(m&&!m.active)alert({severity:'WARNING',code:'INACTIVE_MATERIAL',materialCode:i.code,message:`${i.code}: material inactivo usado por el BOM; se conserva su necesidad para revisión.`});
  }
 }
 const rows=[...groups.values()].sort((a,b)=>a.code.localeCompare(b.code)||a.unit.localeCompare(b.unit));
 for(const r of rows){r.consumers=new Set(r.contributions.map(c=>c.productId)).size;const m=materialMap.get(r.code);
  if(rows.some(x=>x.code===r.code&&x.unit!==r.unit))alert({severity:'WARNING',code:'MULTIPLE_UNITS',materialCode:r.code,message:`${r.code}: usado con varias unidades. Los totales permanecen separados.`});
  if(m?.conversionConfirmed&&m.unitsPerPurchase&&m.unitsPerPurchase>0&&m.conversionFromUnit===r.unit&&m.purchaseUnit){r.purchaseQuantity=r.gross/m.unitsPerPurchase;r.purchasePacks=Math.ceil(r.purchaseQuantity);r.conversionStatus='Factor confirmado; sugerencia sin inventario';}
 }
 return {status:alerts.some(a=>a.severity==='ERROR')?'INCOMPLETE':alerts.length?'WITH_WARNINGS':'READY',rows,alerts,summary:{products:plan.length,plannedByUnit,materials:rows.filter(r=>r.gross>0).length,families:new Set(rows.map(r=>r.family).filter(Boolean)).size,shared:rows.filter(r=>r.consumers>1).length},scope:'BOM SAP directo por alternativa seleccionada. Sin explosión automática de subensambles, inventarios, requerimiento neto ni órdenes de compra.'};
}
