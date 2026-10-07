// Conecta los módulos (Demanda, Restricciones, Tiempos, Costos, Inventario, Entrenamiento, listas SAP) con el plan maestro.
// Lógica pura: recibe filas ya leídas de la base y arma las entradas del modelo. La llave es el código SAP.
import { SINGLE_SHIFT, type MpsArea, type MpsDay, type MpsGroup, type MpsProduct, type MpsShift, type Regime } from './mps';
import { hoursPerUnit, type Operation, type WorkCenter } from './masters';
import { matchesRestriction, type Area, type CalendarDay, type DemandItem, type Restriction } from './planning';

export type SapList={code:string;base:number;items:{code:string;quantity:number}[]};

const areaKey=(a:Pick<Area,'id'>)=>`A${a.id}`;

/**
 * Horas estándar por unidad y por área de cada código: operaciones de su propia hoja de ruta
 * más las de sus componentes fabricados (por ejemplo la estructura de resortes con "Ensamblado de panel",
 * "Elaboración de marcos" y "Enmarcado"), explotando la lista SAP hasta 4 niveles.
 */
export function hoursByArea(ops:Operation[],centers:WorkCenter[],lists:SapList[]){
 const centerArea=new Map(centers.filter(c=>c.area_id!==null).map(c=>[c.code,`A${c.area_id}`]));
 const own=new Map<string,Record<string,number>>();
 const counters=new Map<string,string>();
 for(const o of ops)if(o.active){const c=counters.get(o.material_code);if(c===undefined||Number(o.route_counter)<Number(c))counters.set(o.material_code,o.route_counter);}
 for(const o of ops){if(!o.active||counters.get(o.material_code)!==o.route_counter)continue;const a=o.work_center?centerArea.get(o.work_center):undefined;if(!a)continue;
  const r=own.get(o.material_code)??{};r[a]=(r[a]??0)+hoursPerUnit(o);own.set(o.material_code,r);}
 const listMap=new Map(lists.map(l=>[l.code,l]));const memo=new Map<string,Record<string,number>>();
 const total=(code:string,depth:number,path:Set<string>):Record<string,number>=>{
  if(depth===0&&memo.has(code))return memo.get(code)!;
  const out:Record<string,number>={...(own.get(code)??{})};const l=listMap.get(code);
  if(l&&depth<4&&!path.has(code)){const next=new Set(path).add(code);
   for(const it of l.items){if(!(it.quantity>0)||!(own.has(it.code)||listMap.has(it.code)))continue;const sub=total(it.code,depth+1,next);for(const [a,h] of Object.entries(sub))out[a]=(out[a]??0)+h*it.quantity/(l.base||1);}}
  if(depth===0)memo.set(code,out);return out;};
 return {own,total:(code:string)=>total(code,0,new Set()),hasRoute:(code:string)=>own.has(code)};
}

/** Productos del plan: todos los códigos con demanda activa, aunque no tengan BOM, ruta, costo o stock (se marcan). */
export function buildProducts(items:DemandItem[],hours:ReturnType<typeof hoursByArea>,costs:Map<string,number|null>,stock:Map<string,number>,lots:Map<string,number>,bomCodes:Set<string>,sapCodes:Set<string>,defaultLot:number):MpsProduct[]{
 const active=items.filter(i=>i.active);
 const withRoute=active.map(i=>({i,h:hours.total(i.material_code)})).filter(x=>Object.keys(x.h).length>0);
 return active.map(i=>{
  let h=hours.total(i.material_code);let source:MpsProduct['hoursSource']='RUTA';
  if(!Object.keys(h).length){
   // Sin hoja de ruta: promedio de los modelos del mismo tipo y medida (o del mismo tipo).
   const peers=withRoute.filter(x=>x.i.mattress_type===i.mattress_type&&x.i.size_cm===i.size_cm);const pool=peers.length?peers:withRoute.filter(x=>x.i.mattress_type===i.mattress_type);
   if(pool.length){h={};for(const x of pool)for(const [a,v] of Object.entries(x.h))h[a]=(h[a]??0)+v/pool.length;source='ESTIMADO';}else source='SIN_DATO';}
  const demand=Number(i.monthly_demand);
  return {code:i.material_code,description:i.description,mattressType:i.mattress_type,panelType:i.panel_type,size:i.size_cm,monthlyDemand:demand,hours:h,hoursSource:source,
   unitCost:costs.get(i.material_code)??null,stock:stock.get(i.material_code)??0,lot:lots.get(i.material_code)??(demand>=defaultLot*2?defaultLot:1),
   hasEngineeringBom:bomCodes.has(i.material_code),hasSapList:sapCodes.has(i.material_code)};});
}

/** Grupos de restricción diaria con los códigos que los consumen. Paneles los limita Tapicería; colchones, Cerrado. */
export function buildGroups(restrictions:Restriction[],items:DemandItem[],areas:Area[],areaFor:Record<number,number>={}):MpsGroup[]{
 const find=(name:string)=>areas.find(a=>a.name.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().startsWith(name));
 const tap=find('TAPICERIA'),cer=find('CERRADO');
 return restrictions.filter(r=>r.active).map(r=>{const a=areaFor[r.id]?areas.find(x=>x.id===areaFor[r.id]):(r.applies_to==='PANEL'?tap:cer)??tap;
  return {key:`G${r.id}`,name:r.name,maxPerDay:Number(r.max_per_day),codes:items.filter(i=>i.active&&matchesRestriction(i,r)).map(i=>i.material_code),areaKey:a?areaKey(a):''};});
}

export function buildAreas(areas:Area[],opts:{absenteeismPct:number;hourlyWage:number;efficiency:Record<string,number>;inModel:Record<string,boolean>;wageByArea?:Record<string,number|null>;absenteeismByArea?:Record<string,number|null>}):MpsArea[]{
 return areas.filter(a=>a.active).map(a=>{const k=areaKey(a);return {key:k,name:a.name,headcount:a.headcount??0,absenteeismPct:opts.absenteeismByArea?.[k]??opts.absenteeismPct,hourlyWage:opts.wageByArea?.[k]??opts.hourlyWage,efficiency:opts.efficiency[k]??1,inModel:opts.inModel[k]??(a.limits_capacity||(a.headcount??0)>0)};});
}

export function buildDays(calendar:CalendarDay[]):MpsDay[]{
 return calendar.map(d=>({date:d.day,weekday:d.weekday,ordinaryHours:d.is_working?d.ordinary:0,working:d.is_working&&d.ordinary>0,note:d.note}));
}

// ---------------- Aprendizaje a partir de los programas reales ----------------
export type ProgramInput={name:string;lines:{material_code:string;quantity:number}[]};
export type Learned={
 programs:number;
 efficiency:Record<string,{mean:number;p75:number;max:number;samples:number[]}>; // horas estándar programadas ÷ horas disponibles de una jornada de referencia
 forcing:Record<string,{mean:number;max:number;timesOver:number}>;               // exceso sobre el máximo diario (%)
 lot:number;volume:{mean:number;min:number;max:number};modelsPerDay:number;
 shareByType:Record<string,number>;
};
const quantile=(xs:number[],q:number)=>{if(!xs.length)return 0;const s=[...xs].sort((a,b)=>a-b);const p=(s.length-1)*q;const lo=Math.floor(p),hi=Math.ceil(p);return s[lo]+(s[hi]-s[lo])*(p-lo);};

/**
 * Etapa 1-2 del aprendizaje: con cada programa del programador se mide cuánto trabajo estándar puso en un día
 * (y por lo tanto el rendimiento real que asume), cuánto fuerza cada restricción, el tamaño de lote y la mezcla.
 */
export function learnFromPrograms(programs:ProgramInput[],products:MpsProduct[],areas:MpsArea[],groups:MpsGroup[],referenceHours:number,shifts:MpsShift[]=SINGLE_SHIFT):Learned{
 const map=new Map(products.map(p=>[p.code,p]));const eff:Learned['efficiency']={};const forcing:Learned['forcing']={};
 const active=shifts.filter(s=>s.active!==false);
 for(const a of areas.filter(a=>a.inModel&&a.headcount>0)){
  // Horas de reloj disponibles en un día de programa: cada turno con su personal presente, su productividad y sus horas de referencia.
  const clock=active.reduce((s,sh)=>s+Math.max(0,sh.headcount?.[a.key]??a.headcount)*(1-a.absenteeismPct/100)*sh.productivityPct/100*(sh.referenceHours??referenceHours),0);
  if(!(clock>0))continue;
  const samples=programs.map(pr=>pr.lines.reduce((s,l)=>s+(map.get(l.material_code)?.hours[a.key]??0)*l.quantity,0)/clock).filter(x=>x>0);
  eff[a.key]={mean:samples.reduce((s,x)=>s+x,0)/(samples.length||1),p75:quantile(samples,0.75),max:Math.max(0,...samples),samples};}
 for(const g of groups){const ratios=programs.map(pr=>pr.lines.reduce((s,l)=>g.codes.includes(l.material_code)?s+l.quantity:s,0)/g.maxPerDay);
  const over=ratios.map(r=>Math.max(0,r-1)*100);forcing[g.key]={mean:over.reduce((s,x)=>s+x,0)/(over.length||1),max:Math.max(0,...over),timesOver:over.filter(x=>x>0).length};}
 const qty=programs.flatMap(p=>p.lines.map(l=>l.quantity)).filter(q=>q>0);
 // Lote típico: el mayor múltiplo (50, 25, 10, 5) que cumple al menos el 80 % de las cantidades programadas.
 const lot=[50,25,10,5].find(L=>qty.length>0&&qty.filter(q=>q%L===0).length/qty.length>=0.8)??1;
 const volumes=programs.map(p=>p.lines.reduce((s,l)=>s+l.quantity,0));
 const byType:Record<string,number>={};let tot=0;for(const p of programs)for(const l of p.lines){const t=map.get(l.material_code)?.mattressType??'?';byType[t]=(byType[t]??0)+l.quantity;tot+=l.quantity;}
 for(const k of Object.keys(byType))byType[k]=byType[k]/(tot||1);
 return {programs:programs.length,efficiency:eff,forcing,lot,volume:{mean:volumes.reduce((s,x)=>s+x,0)/(volumes.length||1),min:Math.min(...volumes),max:Math.max(...volumes)},modelsPerDay:programs.reduce((s,p)=>s+p.lines.filter(l=>l.quantity>0).length,0)/(programs.length||1),shareByType:byType};
}

/**
 * Regímenes de trabajo a partir de lo aprendido: Normal usa el rendimiento promedio del programador,
 * Presionado el percentil 75 y Esfuerzo máximo el mayor observado; el forzado de restricciones igual.
 */
export function regimesFromLearning(l:Learned|null,base:Regime[]):{regimes:Regime[];efficiency:Record<string,number>}{
 if(!l||!l.programs)return {regimes:base,efficiency:{}};
 const efficiency:Record<string,number>={};for(const [k,v] of Object.entries(l.efficiency))efficiency[k]=Math.max(0.5,Math.min(3,v.mean||1));
 const ratio=(q:'p75'|'max')=>{const r=Object.values(l.efficiency).filter(v=>v.mean>0).map(v=>v[q]/v.mean);return r.length?Math.max(1,r.reduce((a,b)=>a+b,0)/r.length):1;};
 const f=Object.values(l.forcing);const fMean=f.length?Math.max(...f.map(x=>x.mean)):0,fMax=f.length?Math.max(...f.map(x=>x.max)):0;
 const round=(x:number)=>Math.round(x*100)/100;
 return {efficiency,regimes:base.map(r=>r.key==='NORMAL'?{...r,efficiencyFactor:1,forcingPct:0}:r.key==='PRESIONADO'?{...r,efficiencyFactor:round(Math.max(r.efficiencyFactor,ratio('p75'))),forcingPct:round(Math.max(r.forcingPct,fMean))}:{...r,efficiencyFactor:round(Math.max(r.efficiencyFactor,ratio('max'))),forcingPct:round(Math.max(r.forcingPct,fMax))})};
}
