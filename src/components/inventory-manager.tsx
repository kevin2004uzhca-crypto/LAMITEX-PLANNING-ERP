'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Upload, X } from 'lucide-react';
import type { DemandItem, PlanningCode, Restriction } from '@/lib/planning';
import { groupCatalog, groupsOf } from '@/lib/planning-groups';
import { INVENTORY_COLUMNS, inventoryCost } from '@/lib/masters';
import type { StockRecord } from '@/lib/planning-server';
import { day, HistoryButton, ImportLog, MasterUpload, postJson, today, when } from './master-tools';

type Cost={material_code:string;price:number|null;inventory_cost_pct:number|null};
type Props={stock:StockRecord[];items:DemandItem[];costs:Cost[];defaultPct:number;imports:any[];canEdit:boolean;codes:PlanningCode[];restrictions:Restriction[]};
type Row={code:string;stock:StockRecord|null;item:DemandItem|null;cost:Cost|null};
const n0=new Intl.NumberFormat('es-EC',{maximumFractionDigits:0}),n2=new Intl.NumberFormat('es-EC',{maximumFractionDigits:2}),money=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:2});

/** Cobertura del mes: qué porcentaje de la demanda mensual cubre el stock libre. */
const coverPct=(qty:number|null,demand:number|undefined)=>demand&&demand>0&&qty!==null?Math.max(0,qty)/demand*100:null;
const coverBadge=(p:number)=>p<25?'badge error':p<100?'badge warning':'badge';

export function InventoryManager({stock,items,costs,defaultPct,imports,canEdit,codes,restrictions}:Props){
 const router=useRouter();
 const [q,setQ]=useState(''),[view,setView]=useState('demand'),[group,setGroup]=useState(''),[limit,setLimit]=useState(300),[upload,setUpload]=useState(false),[notice,setNotice]=useState('');
 const [draft,setDraft]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const rows=useMemo(()=>{const map=new Map<string,Row>();const costMap=new Map(costs.map(c=>[c.material_code,c]));
  for(const s of stock)map.set(s.material_code,{code:s.material_code,stock:s,item:null,cost:costMap.get(s.material_code)??null});
  for(const i of items){const r=map.get(i.material_code)??{code:i.material_code,stock:null,item:null,cost:costMap.get(i.material_code)??null};r.item=i;map.set(i.material_code,r);}
  return [...map.values()].map(r=>({...r,groups:groupsOf(r.item??undefined,restrictions)}));},[stock,items,costs,restrictions]);
 const groupDefs=useMemo(()=>groupCatalog(codes,restrictions),[codes,restrictions]);
 // Stock, demanda y cobertura del mes por grupo (los mismos grupos de Restricciones y los tipos de colchón y panel).
 const groupStats=useMemo(()=>groupDefs.map(g=>{const rs=rows.filter(r=>r.item?.active&&r.groups.includes(g.key));const stockQty=rs.reduce((t,r)=>t+Math.max(0,r.stock?.free_stock??0),0);const demand=rs.reduce((t,r)=>t+Number(r.item?.monthly_demand??0),0);
  return {...g,models:rs.length,stock:stockQty,demand,cover:coverPct(stockQty,demand),short:rs.filter(r=>(coverPct(r.stock?.free_stock??0,r.item?.monthly_demand)??100)<25).length};}).filter(g=>g.models>0),[groupDefs,rows]);
 const current=groupStats.find(g=>g.key===group);
 const filtered=useMemo(()=>{const t=q.trim().toUpperCase();return rows.filter(r=>(!group||r.groups.includes(group))&&(view==='all'||(view==='demand'?r.item?.active:view==='stock'?(r.stock?.free_stock??0)>0:view==='missing'?!r.stock:false))&&(!t||r.code.toUpperCase().includes(t)||(r.stock?.description??r.item?.description??'').toUpperCase().includes(t)))
  .sort((a,b)=>view==='demand'?(b.item?.monthly_demand??0)-(a.item?.monthly_demand??0):a.code.localeCompare(b.code));},[rows,q,view,group]);
 const demandRows=rows.filter(r=>r.item?.active);
 const value=rows.reduce((s,r)=>r.stock&&r.stock.free_stock>0&&r.cost?.price!=null?s+r.stock.free_stock*r.cost.price:s,0);
 const lastDate=stock.reduce<string|null>((m,s)=>!m||s.stock_date>m?s.stock_date:m,null);
 const finished=demandRows.reduce((s,r)=>s+Math.max(0,r.stock?.free_stock??0),0);
 const open=(r?:Row)=>{setError('');const s=r?.stock;setDraft({isNew:!s,locked:!!r,material_code:r?.code??'',description:s?.description??r?.item?.description??'',free_stock:s?.free_stock??0,in_transit:s?.in_transit??0,base_unit:s?.base_unit??'UN',stock_date:today(),active:s?.active??true,notes:s?.notes??''});};
 async function save(){setBusy(true);setError('');try{await postJson('/api/masters',{action:'stock',...draft});setNotice(`Inventario de ${draft.material_code} guardado con fecha ${day(draft.stock_date)}.`);setDraft(null);router.refresh();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}

 return <>
  <div className="metrics compact">
   <div><span>Materiales con stock</span><strong>{n0.format(stock.filter(s=>s.free_stock>0).length)}</strong><small>de {n0.format(stock.length)} en el Kardex</small></div>
   <div><span>Colchones de la demanda en bodega</span><strong>{n0.format(finished)}</strong><small>{demandRows.filter(r=>(r.stock?.free_stock??0)>0).length} de {demandRows.length} modelos con stock</small></div>
   <div><span>Valor del inventario</span><strong className="metric-text">{money.format(value)}</strong><small>stock × costo de producción</small></div>
   <div><span>Última actualización</span><strong className="metric-text">{day(lastDate)}</strong><small>fecha del corte más reciente</small></div>
  </div>
  {notice&&<p className="alert" role="status">{notice} <button className="link-button" onClick={()=>setNotice('')}>Cerrar</button></p>}
  <div className="toolbar-row">{canEdit&&<button className="primary" onClick={()=>open()}><Plus size={16}/>Agregar material</button>}{canEdit&&<button className={upload?'selected-tool':''} onClick={()=>setUpload(!upload)}><Upload size={16}/>Carga masiva (Kardex)</button>}</div>
  {upload&&<MasterUpload kind="INVENTARIO" title="Carga masiva de inventario" columns={INVENTORY_COLUMNS} help="Sube el Kardex exportado de SAP e indica la fecha del corte. Cada material del archivo actualiza su libre utilización y su fecha; los que no vienen en el archivo conservan su último dato." onDone={m=>{setNotice(m);setUpload(false);router.refresh();}}/>}
  {groupStats.some(g=>g.kind==='RESTRICCION')&&<section className="panel"><h2>Cobertura del mes por grupo</h2><p>Los grupos de Restricciones (caja, piloto, paneles jumbo, confort…). Toca un grupo para ver sus modelos.</p>
   <div className="table-scroll"><table><thead><tr><th>Grupo</th><th className="number">Modelos</th><th className="number">Stock libre</th><th className="number">Demanda mensual</th><th className="number">Cobertura del mes</th><th className="number">Modelos bajo 25 %</th></tr></thead>
    <tbody>{groupStats.filter(g=>g.kind==='RESTRICCION').map(g=><tr key={g.key} className={group===g.key?'selected-row':''}><td><button className="link-button" onClick={()=>{setGroup(group===g.key?'':g.key);setView('demand');setLimit(300);}}>{g.label}</button></td><td className="number">{g.models}</td><td className="number">{n0.format(g.stock)}</td><td className="number">{n0.format(g.demand)}</td><td className="number">{g.cover===null?'—':<span className={coverBadge(g.cover)}>{n0.format(g.cover)} %</span>}</td><td className="number">{g.short||'—'}</td></tr>)}</tbody></table></div></section>}
  <section className="panel">
   <form className="filters" onSubmit={e=>e.preventDefault()}><label>Código SAP o texto breve<input value={q} onChange={e=>{setQ(e.target.value);setLimit(300);}} placeholder="Ej. 3C80595"/></label>
    <label>Mostrar<select value={view} onChange={e=>{setView(e.target.value);setLimit(300);}}><option value="demand">Colchones de la demanda</option><option value="stock">Con stock</option><option value="missing">Sin dato de inventario</option><option value="all">Todos los materiales</option></select></label>
    <label>Grupo<select value={group} onChange={e=>{setGroup(e.target.value);setLimit(300);}}><option value="">Todos los grupos</option>
     {(['RESTRICCION','COLCHON','PANEL'] as const).map(k=><optgroup key={k} label={k==='RESTRICCION'?'Grupos de Restricciones':k==='COLCHON'?'Tipo de colchón':'Tipo de panel'}>{groupStats.filter(g=>g.kind===k).map(g=><option key={g.key} value={g.key}>{g.label}</option>)}</optgroup>)}</select></label></form>
   {current&&<div className="metrics compact"><div><span>{current.label}</span><strong>{n0.format(current.models)}</strong><small>modelos de la demanda</small></div><div><span>Stock libre</span><strong>{n0.format(current.stock)}</strong><small>colchones en bodega</small></div><div><span>Demanda mensual</span><strong>{n0.format(current.demand)}</strong><small>colchones por mes</small></div><div><span>Cobertura del mes</span><strong>{current.cover===null?'—':`${n0.format(current.cover)} %`}</strong><small>{current.short} modelos bajo el 25 %</small></div></div>}
   <div className="table-scroll tall"><table><thead><tr><th>Material</th><th>Texto breve material</th><th className="number">Libre utilización</th><th>Fecha de actualización</th><th className="number">Demanda mensual</th><th className="number">Cobertura del mes</th><th className="number">Valor</th><th className="number">Costo de mantenerlo</th><th/></tr></thead>
    <tbody>{filtered.slice(0,limit).map(r=>{const s=r.stock;const qty=s?.free_stock??null;const ic=r.cost?inventoryCost(r.cost.price,r.cost.inventory_cost_pct,defaultPct):null;const cover=coverPct(qty,r.item?.monthly_demand);
     return <tr key={r.code} className={s&&!s.active?'inactive-row':''}>
     <td className="mono">{r.code}</td><td>{s?.description??r.item?.description}{!s&&<span className="badge warning">Sin dato</span>}</td>
     <td className="number"><b>{qty===null?'—':n2.format(qty)}</b>{s?.base_unit&&<small className="muted"> {s.base_unit}</small>}{s&&s.in_transit>0&&<><br/><small className="muted">+{n2.format(s.in_transit)} en tránsito</small></>}</td>
     <td>{day(s?.stock_date)}<br/><small className="muted">{s?(s.last_source==='MANUAL'?`editado ${when(s.updated_at)}`:'carga masiva'):''}</small></td>
     <td className="number">{r.item?n0.format(r.item.monthly_demand):'—'}</td>
     <td className="number">{cover===null?'—':<span className={coverBadge(cover)}>{n0.format(cover)} %</span>}</td>
     <td className="number">{qty!==null&&qty>0&&r.cost?.price!=null?money.format(qty*r.cost.price):'—'}</td>
     <td className="number">{qty!==null&&qty>0&&ic!==null?money.format(qty*ic):'—'}</td>
     <td className="row-actions">{canEdit&&<button className="compact-button" onClick={()=>open(r)}><Pencil size={14}/>{s?'Editar':'Agregar'}</button>}{s&&<HistoryButton table="inventory_stock" code={r.code} fields={['free_stock','in_transit','stock_date','description']}/>}</td></tr>;})}</tbody></table></div>
   <div className="pagination"><span>{filtered.length} materiales</span>{filtered.length>limit&&<button onClick={()=>setLimit(limit+500)}>Mostrar más</button>}</div>
   <p className="footnote">Cobertura del mes = libre utilización ÷ demanda mensual, en %. 100 % = el stock alcanza para todo el mes. En rojo, menos del 25 % (una semana); en amarillo, menos del 100 %. El costo de mantenerlo usa el % de inventario del módulo Costos.</p>
  </section>
  <ImportLog rows={imports} snapshot/>
  {draft&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Editar inventario"><div className="modal">
   <div className="section-heading"><div><p className="eyebrow">{draft.isNew?'NUEVO REGISTRO':'EDITAR INVENTARIO'}</p><h2>{draft.material_code||'Material'}</h2></div><button className="icon-button" onClick={()=>setDraft(null)} aria-label="Cerrar"><X size={18}/></button></div>
   <div className="bom-form-grid">
    <label>Material (código SAP)<input value={draft.material_code} disabled={draft.locked} onChange={e=>setDraft({...draft,material_code:e.target.value})}/></label>
    <label>Fecha de actualización<input type="date" value={draft.stock_date} max={today()} onChange={e=>setDraft({...draft,stock_date:e.target.value})}/></label>
    <label className="span-2">Texto breve material<input value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    <label>Libre utilización<input type="number" step="0.001" value={draft.free_stock} onChange={e=>setDraft({...draft,free_stock:e.target.value})} autoFocus/></label>
    <label>Unidad<input value={draft.base_unit??''} onChange={e=>setDraft({...draft,base_unit:e.target.value.toUpperCase()})}/></label>
    <label>Stock en tránsito<input type="number" min="0" step="0.001" value={draft.in_transit} onChange={e=>setDraft({...draft,in_transit:e.target.value})}/></label>
    <label className="inline-check"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Activo</label>
    <label className="span-2">Notas<input value={draft.notes??''} onChange={e=>setDraft({...draft,notes:e.target.value})} placeholder="Ej. conteo físico, ajuste"/></label>
   </div>
   {error&&<p className="alert error">{error}</p>}
   <div className="toolbar-row end"><button onClick={()=>setDraft(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar'}</button></div>
  </div></div>}
 </>;
}
