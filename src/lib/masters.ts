// Lógica pura de costos, inventario y hojas de ruta. La llave común es el código de material SAP.
import type { Area, CalendarDay, DemandItem } from './planning';

type Cell=string|number|null;
const plain=(v:unknown)=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim().toUpperCase();
const str=(v:Cell)=>{const s=String(v??'').replace(/\s+/g,' ').trim();return s||null;};
const num=(v:Cell)=>{if(v===null||v==='')return null;const s=String(v).replace(/\s/g,'');const n=typeof v==='number'?v:Number(s.includes('.')?s.replace(/,/g,''):s.replace(',','.'));return Number.isFinite(n)?n:NaN;};
/** Fechas SAP: ISO (2026-01-01), 01.01.2026 o 01/01/2026. */
export function sapDate(v:Cell):string|null|undefined{
 if(v===null||v==='')return null;const s=String(v).trim();
 let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
 m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 if(typeof v==='number'&&v>20000&&v<80000)return new Date(Date.UTC(1899,11,30)+v*864e5).toISOString().slice(0,10);
 return undefined;
}

type Spec={key:string;header:string;required?:boolean};
/** Ubica cada columna por su nombre (sin importar el orden). Con nombres repetidos toma la primera. */
function mapHeaders(rows:Cell[][],specs:Spec[]){
 const idx=rows.findIndex(r=>r.some(c=>plain(c)==='MATERIAL'));
 if(idx<0)throw new Error('No se encontró la columna "Material".');
 const head=rows[idx].map(plain);const cols:Record<string,number>={};
 for(const s of specs){const i=head.indexOf(plain(s.header));if(i>=0)cols[s.key]=i;else if(s.required)throw new Error(`Falta la columna "${s.header}". Columnas requeridas: ${specs.filter(x=>x.required).map(x=>x.header).join(' · ')}.`);}
 return {idx,cols};
}
type Parsed<T>={rows:T[];errors:string[];warnings:string[]};
function parseRows<T extends {material_code:string}>(rows:Cell[][],specs:Spec[],build:(get:(k:string)=>Cell,line:number,errors:string[],warnings:string[])=>T|null,unique:(r:T)=>string=(r)=>r.material_code):Parsed<T>{
 const {idx,cols}=mapHeaders(rows,specs);const out:T[]=[];const errors:string[]=[];const warnings:string[]=[];const seen=new Map<string,number>();
 // SAP distingue "2T20450" de "2T20450 " (con espacio final): si ambos existen, el segundo conserva su código exacto.
 const exact=new Set(rows.slice(idx+1).map(r=>cols.material===undefined?'':String(r[cols.material]??'')));
 rows.forEach((r,i)=>{if(i<=idx)return;const line=i+1;const get=(k:string)=>cols[k]===undefined?null:r[cols[k]];
  if(r.every(c=>c===null||String(c).trim()===''))return;
  const raw=get('material');if(raw===null||String(raw).trim()===''){warnings.push(`Fila ${line}: sin código de material (fila de totales u observación); se ignora.`);return;}
  if(plain(raw)==='MATERIAL')return;
  const text=String(raw),trimmed=text.trim();let code=trimmed;
  if(text!==trimmed){if(exact.has(trimmed)){code=text;warnings.push(`Fila ${line}: "${trimmed}" con espacio final es otro material en SAP; se conserva su código exacto.`);}else warnings.push(`Fila ${line}: el código "${text}" tenía espacios; se usa "${trimmed}".`);}
  if(/\s/.test(trimmed)){errors.push(`Fila ${line}: código de material con espacios internos.`);return;}
  const row=build((k:string)=>k==='material'?code:get(k),line,errors,warnings);if(!row)return;
  const key=unique(row);if(seen.has(key)){errors.push(`Fila ${line} (${row.material_code}): repetido; ya aparece en la fila ${seen.get(key)}.`);return;}
  seen.set(key,line);out.push(row);});
 if(!out.length&&!errors.length)errors.push('El archivo no tiene filas con material.');
 if(warnings.length>200)warnings.splice(200,warnings.length-200,`… y ${warnings.length-200} avisos más.`);
 return {rows:out,errors,warnings};
}

export const COST_COLUMNS=['Material','Centro','Clase de valoración','Texto breve material','Última modificación','Tipo material','Grupo de artículos','Unidad medida base','Precio','Moneda'];
export type CostRow={material_code:string;description:string;center:string|null;valuation_class:string|null;material_type:string|null;article_group:string|null;base_unit:string|null;price:number|null;currency:string;price_updated_at:string|null};
export function parseCosts(rows:Cell[][]):Parsed<CostRow>{
 return parseRows(rows,[{key:'material',header:'Material',required:true},{key:'center',header:'Centro'},{key:'class',header:'Clase de valoración'},{key:'desc',header:'Texto breve material',required:true},{key:'date',header:'Última modificación'},{key:'type',header:'Tipo material'},{key:'group',header:'Grupo de artículos'},{key:'unit',header:'Unidad medida base'},{key:'price',header:'Precio',required:true},{key:'currency',header:'Moneda'}],
  (get,line,errors,warnings)=>{const code=String(get('material'));const price=num(get('price'));const date=sapDate(get('date'));
   if(Number.isNaN(price)||(price!==null&&price<0)){errors.push(`Fila ${line} (${code}): precio inválido.`);return null;}
   if(price===null)warnings.push(`Fila ${line} (${code}): sin precio; queda pendiente para completar en el ERP.`);
   if(date===undefined)warnings.push(`Fila ${line} (${code}): fecha de última modificación no reconocida; se deja vacía.`);
   return {material_code:code,description:str(get('desc'))??code,center:str(get('center')),valuation_class:str(get('class')),material_type:str(get('type')),article_group:str(get('group')),base_unit:str(get('unit')),price,currency:str(get('currency'))??'USD',price_updated_at:date??null};});
}

export const INVENTORY_COLUMNS=['Material','Texto breve material','Centro','Almacén','Unidad medida base','Libre utilización','Nombre 1','Grupo de artículos','Stock en tránsito','Valor libre util.','Ajustes Offline'];
export type InventoryRow={material_code:string;description:string;center:string|null;warehouse:string|null;warehouse_name:string|null;article_group:string|null;base_unit:string|null;free_stock:number;in_transit:number;free_value:number|null};
export function parseInventory(rows:Cell[][]):Parsed<InventoryRow>{
 return parseRows(rows,[{key:'material',header:'Material',required:true},{key:'desc',header:'Texto breve material',required:true},{key:'center',header:'Centro'},{key:'wh',header:'Almacén'},{key:'unit',header:'Unidad medida base'},{key:'free',header:'Libre utilización',required:true},{key:'whname',header:'Nombre 1'},{key:'group',header:'Grupo de artículos'},{key:'transit',header:'Stock en tránsito'},{key:'value',header:'Valor libre util.'}],
  (get,line,errors,warnings)=>{const code=String(get('material'));const free=num(get('free')),transit=num(get('transit')),value=num(get('value'));
   if(free===null||Number.isNaN(free)){errors.push(`Fila ${line} (${code}): libre utilización inválida.`);return null;}
   if(free<0)warnings.push(`Fila ${line} (${code}): stock negativo (${free}); se conserva tal como viene de SAP.`);
   if(Number.isNaN(transit)||Number.isNaN(value)){errors.push(`Fila ${line} (${code}): stock en tránsito o valor inválido.`);return null;}
   return {material_code:code,description:str(get('desc'))??code,center:str(get('center')),warehouse:str(get('wh')),warehouse_name:str(get('whname')),article_group:str(get('group')),base_unit:str(get('unit')),free_stock:free,in_transit:transit??0,free_value:value};});
}

export const ROUTING_COLUMNS=['Centro','Material','Descripción de hoja de ruta','Número de operación','Clave de control','Cantidad base','Unidad de medida de la operación','Valor prefijado','Unidad de medida valor prefijado','Texto breve operación','Puesto de trabajo','Contador grupo hojas ruta'];
export type RoutingRow={material_code:string;route_counter:string;operation:string;center:string|null;route_description:string|null;control_key:string|null;base_quantity:number;op_unit:string|null;standard_value:number;standard_unit:'H'|'MIN'|'S';operation_text:string|null;work_center:string|null};
const unitOf=(v:Cell):RoutingRow['standard_unit']|null=>{const u=plain(v);if(!u||u==='H'||u==='HR'||u==='HRS'||u==='STD')return 'H';if(u==='MIN')return 'MIN';if(u==='S'||u==='SEG')return 'S';return null;};
export function parseRoutings(rows:Cell[][]):Parsed<RoutingRow>{
 return parseRows(rows,[{key:'center',header:'Centro'},{key:'material',header:'Material',required:true},{key:'desc',header:'Descripción de hoja de ruta'},{key:'op',header:'Número de operación',required:true},{key:'key',header:'Clave de control'},{key:'base',header:'Cantidad base'},{key:'unit',header:'Unidad de medida de la operación'},{key:'value',header:'Valor prefijado',required:true},{key:'vunit',header:'Unidad de medida valor prefijado'},{key:'text',header:'Texto breve operación'},{key:'wc',header:'Puesto de trabajo'},{key:'counter',header:'Contador grupo hojas ruta'}],
  (get,line,errors)=>{const code=String(get('material'));const op=str(get('op'));const base=num(get('base'));const value=num(get('value'));const unit=unitOf(get('vunit'));
   if(!op){errors.push(`Fila ${line} (${code}): falta el número de operación.`);return null;}
   if(base!==null&&(Number.isNaN(base)||base<=0)){errors.push(`Fila ${line} (${code}): cantidad base inválida.`);return null;}
   if(value===null||Number.isNaN(value)||value<0){errors.push(`Fila ${line} (${code}): valor prefijado (tiempo) inválido.`);return null;}
   if(!unit){errors.push(`Fila ${line} (${code}): unidad de tiempo "${get('vunit')}" no reconocida (usa H, MIN o S).`);return null;}
   return {material_code:code,route_counter:str(get('counter'))??'1',operation:/^\d+$/.test(op)?op.padStart(4,'0'):op,center:str(get('center')),route_description:str(get('desc')),control_key:str(get('key')),base_quantity:base??1,op_unit:str(get('unit')),standard_value:value,standard_unit:unit,operation_text:str(get('text')),work_center:str(get('wc'))};},
  r=>`${r.material_code}|${r.route_counter}|${r.operation}`);
}

// ---------------- Cálculos que conectan los módulos ----------------
export type Operation=RoutingRow&{id:number;active:boolean;notes?:string|null;updated_at?:string;last_source?:string};
export type WorkCenter={code:string;name:string;area_id:number|null;notes:string|null};
/** Horas por unidad de una operación = valor prefijado ÷ cantidad base, convertido a horas. */
export const hoursPerUnit=(o:Pick<RoutingRow,'standard_value'|'standard_unit'|'base_quantity'>)=>{const f=o.standard_unit==='MIN'?1/60:o.standard_unit==='S'?1/3600:1;return Number(o.standard_value)*f/Number(o.base_quantity||1);};

export type RouteSummary={material_code:string;description:string|null;route_counter:string;counters:string[];operations:Operation[];hours:number;byCenter:Record<string,number>};
/** Hoja de ruta principal de cada material (contador más bajo) con su tiempo total por unidad. */
export function summarizeRoutes(ops:Operation[]):Map<string,RouteSummary>{
 const groups=new Map<string,Operation[]>();for(const o of ops)if(o.active){const g=groups.get(o.material_code)??[];g.push(o);groups.set(o.material_code,g);}
 const out=new Map<string,RouteSummary>();
 for(const [code,list] of groups){const counters=[...new Set(list.map(o=>o.route_counter))].sort((a,b)=>Number(a)-Number(b)||a.localeCompare(b));const main=list.filter(o=>o.route_counter===counters[0]).sort((a,b)=>a.operation.localeCompare(b.operation));
  const byCenter:Record<string,number>={};for(const o of main){const k=o.work_center??'SIN PUESTO';byCenter[k]=(byCenter[k]??0)+hoursPerUnit(o);}
  out.set(code,{material_code:code,description:main[0]?.route_description??null,route_counter:counters[0],counters,operations:main,hours:main.reduce((s,o)=>s+hoursPerUnit(o),0),byCenter});}
 return out;
}

export type AreaLoad={area:Area|null;areaName:string;centers:string[];required:number;available:number|null;usage:number|null};
/** Horas que exige la demanda mensual por área (según las hojas de ruta) contra las horas-persona disponibles del mes. */
export function areaLoad(items:DemandItem[],routes:Map<string,RouteSummary>,centers:WorkCenter[],areas:Area[],calendar:CalendarDay[]){
 const req=new Map<string,{area:Area|null;centers:Set<string>;hours:number}>();const missing:DemandItem[]=[];
 for(const i of items.filter(i=>i.active&&i.monthly_demand>0)){const r=routes.get(i.material_code);if(!r){missing.push(i);continue;}
  for(const [wc,h] of Object.entries(r.byCenter)){const area=areas.find(a=>a.id===centers.find(c=>c.code===wc)?.area_id)??null;const key=area?String(area.id):'none';
   const g=req.get(key)??{area,centers:new Set<string>(),hours:0};g.centers.add(wc);g.hours+=h*i.monthly_demand;req.set(key,g);}}
 const rows:AreaLoad[]=[...req.values()].map(g=>{let available:number|null=null;
  if(g.area&&g.area.headcount!==null){available=calendar.filter(d=>d.is_working).reduce((s,d)=>s+d.hours*g.area!.headcount!*(d.attendance[g.area!.id]??g.area!.default_attendance_pct)/100,0);}
  return {area:g.area,areaName:g.area?.name??'Puestos sin área asignada',centers:[...g.centers].sort(),required:g.hours,available,usage:available?g.hours/available:null};})
  .sort((a,b)=>(a.area?a.area.sort:999)-(b.area?b.area.sort:999));
 return {rows,missing};
}

/** Costo de inventario por unidad: % del material o, si no tiene, el % general. */
export const inventoryCost=(price:number|null,pct:number|null,defaultPct:number)=>price===null?null:price*(pct??defaultPct)/100;
