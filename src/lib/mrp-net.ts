// MRP neto alimentado por el plan maestro. Explota dos fuentes por código SAP del colchón:
//  A) el árbol BOM de ingeniería (todos los niveles, padres, subensambles y lead time), y
//  B) la lista de materiales SAP, que trae además los consumibles (pegas, hilos, gomas, grapas, etiquetas…).
// Un material SAP vinculado a un nodo del árbol se marca "también en BOM"; el resto son "complementarios".
// Las necesidades de compra se calculan con los códigos SAP (tienen unidad y stock); el árbol muestra la estructura.

export type TreeNode={id:number;key:string;parentKey:string|null;name:string;quantity:number;unit:string|null;leadTime:number|null;type:string|null;active:boolean};
export type Tree={bomId:number;code:string;nodes:TreeNode[]};
export type SapListFull={headerId:number;code:string;base:number;unit:string|null;items:{code:string;description:string|null;quantity:number;unit:string|null}[]};
export type MaterialInfo={description:string|null;family:string|null;leadDays:number|null;safetyStock:number|null;purchaseUnit:string|null;unitsPerPurchase:number|null;conversionConfirmed:boolean;conversionFromUnit:string|null};
export type PlanRow={code:string;description:string;weekly:number[]};

export type BomComponentRow={name:string;unit:string;type:string|null;level:number;leadTime:number|null;materialCode:string|null;weekly:number[];total:number;products:string[]};
export type SapMaterialRow={code:string;description:string;unit:string;family:string|null;origin:'BOM'|'COMPLEMENTARIO';weekly:number[];gross:number;stock:number;inTransit:number;net:number;netWeekly:number[];releaseWeek:number|null;purchaseUnit:string|null;purchaseQuantity:number|null;products:string[]};
export type MrpNetResult={weeks:string[];bomComponents:BomComponentRow[];sapMaterials:SapMaterialRow[];
 coverage:{code:string;description:string;planned:number;tree:boolean;sap:boolean}[];alerts:string[]};

const key=(a:string,b:string)=>`${a}|${b}`;

export function calculateNetMrp(plan:PlanRow[],weeks:string[],trees:Map<string,Tree>,lists:Map<string,SapListFull>,materials:Map<string,MaterialInfo>,stock:Map<string,{free:number;transit:number}>,nodeMap:Map<number,string>,opts:{useTransit:boolean}={useTransit:true}):MrpNetResult{
 const alerts:string[]=[];const comps=new Map<string,BomComponentRow>();const mats=new Map<string,SapMaterialRow>();
 const coverage=plan.filter(p=>p.weekly.some(q=>q>0)).map(p=>({code:p.code,description:p.description,planned:p.weekly.reduce((a,b)=>a+b,0),tree:trees.has(p.code),sap:lists.has(p.code)}));
 for(const p of plan){const total=p.weekly.reduce((a,b)=>a+b,0);if(total<=0)continue;
  // A) Árbol de ingeniería: cantidad acumulada = producto de cantidades desde la raíz.
  const tree=trees.get(p.code);const mapped=new Set<string>();
  if(tree){const nodes=tree.nodes.filter(n=>n.active);const byKey=new Map(nodes.map(n=>[n.key,n]));
   const factor=(n:TreeNode,depth=0):number=>{if(depth>20)return 0;const parent=n.parentKey?byKey.get(n.parentKey):undefined;return Number(n.quantity)*(parent?factor(parent,depth+1):1);};
   const level=(n:TreeNode,depth=1):number=>{const parent=n.parentKey?byKey.get(n.parentKey):undefined;return parent&&depth<20?level(parent,depth+1):depth;};
   for(const n of nodes){const f=factor(n);const code=nodeMap.get(n.id)??null;if(code)mapped.add(code);
    const k=key(n.name.trim().toUpperCase(),n.unit??'UN');const r=comps.get(k)??{name:n.name.trim(),unit:n.unit??'UN',type:n.type,level:level(n),leadTime:n.leadTime,materialCode:code,weekly:weeks.map(()=>0),total:0,products:[]};
    p.weekly.forEach((q,w)=>r.weekly[w]+=q*f);r.total+=total*f;if(!r.products.includes(p.code))r.products.push(p.code);if(code&&!r.materialCode)r.materialCode=code;comps.set(k,r);}}
  // B) Lista SAP (incluye consumibles). Cantidad por unidad = cantidad del componente ÷ cantidad base.
  const list=lists.get(p.code);
  if(list){for(const it of list.items){if(!(it.quantity>0))continue;const m=materials.get(it.code);const unit=it.unit??'';
    const k=key(it.code,unit);const r=mats.get(k)??{code:it.code,description:it.description??m?.description??it.code,unit,family:m?.family??null,origin:'COMPLEMENTARIO',weekly:weeks.map(()=>0),gross:0,stock:0,inTransit:0,net:0,netWeekly:weeks.map(()=>0),releaseWeek:null,purchaseUnit:m?.purchaseUnit??null,purchaseQuantity:null,products:[]};
    const per=it.quantity/(list.base||1);p.weekly.forEach((q,w)=>r.weekly[w]+=q*per);r.gross+=total*per;if(mapped.has(it.code))r.origin='BOM';if(!r.products.includes(p.code))r.products.push(p.code);mats.set(k,r);}}
 }
 // Neteo semana a semana contra el inventario (libre utilización + tránsito) y stock de seguridad; liberación según lead time.
 for(const r of mats.values()){const s=stock.get(r.code);const m=materials.get(r.code);r.stock=s?.free??0;r.inTransit=s?.transit??0;
  let available=Math.max(0,r.stock+(opts.useTransit?r.inTransit:0)-(m?.safetyStock??0));
  r.weekly.forEach((g,w)=>{const net=Math.max(0,g-available);available=Math.max(0,available-g);r.netWeekly[w]=net;});
  r.net=r.netWeekly.reduce((a,b)=>a+b,0);const first=r.netWeekly.findIndex(x=>x>0);
  if(first>=0)r.releaseWeek=first-Math.ceil((m?.leadDays??0)/7);
  if(m?.conversionConfirmed&&m.unitsPerPurchase&&m.unitsPerPurchase>0&&m.conversionFromUnit===r.unit)r.purchaseQuantity=Math.ceil(r.net/m.unitsPerPurchase);}
 const noTree=coverage.filter(c=>!c.tree),noSap=coverage.filter(c=>!c.sap),none=coverage.filter(c=>!c.tree&&!c.sap);
 if(noTree.length)alerts.push(`${noTree.length} códigos del plan no tienen árbol BOM de ingeniería (${Math.round(noTree.reduce((s,c)=>s+c.planned,0))} colchones). Sus materiales salen solo de la lista SAP.`);
 if(none.length)alerts.push(`${none.length} códigos no tienen ni árbol BOM ni lista SAP: ${none.slice(0,12).map(c=>c.code).join(', ')}${none.length>12?'…':''}. No se pueden calcular sus materiales; créalos en Gestión de BOM.`);
 if(noSap.length&&!none.length)alerts.push(`${noSap.length} códigos no tienen lista SAP activa.`);
 if(![...mats.values()].some(r=>r.origin==='BOM'))alerts.push('Todavía no hay componentes del árbol vinculados a un código SAP: todos los materiales SAP se muestran como complementarios hasta que confirmes los vínculos.');
 return {weeks,bomComponents:[...comps.values()].sort((a,b)=>a.level-b.level||b.total-a.total),sapMaterials:[...mats.values()].sort((a,b)=>(a.origin===b.origin?0:a.origin==='BOM'?-1:1)||b.net-a.net||a.code.localeCompare(b.code)),coverage,alerts};
}
