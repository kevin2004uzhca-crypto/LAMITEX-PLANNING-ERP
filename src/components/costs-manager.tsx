'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Upload, X } from 'lucide-react';
import type { DemandItem } from '@/lib/planning';
import { COST_COLUMNS, inventoryCost } from '@/lib/masters';
import type { CostRecord } from '@/lib/planning-server';
import { day, HistoryButton, ImportLog, MasterUpload, postJson, when } from './master-tools';

type Props={costs:CostRecord[];items:DemandItem[];stock:{material_code:string;free_stock:number}[];defaultPct:number;imports:any[];canEdit:boolean};
const money=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:2}),unitMoney=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:4}),n0=new Intl.NumberFormat('es-EC',{maximumFractionDigits:0});
type Row={code:string;cost:CostRecord|null;item:DemandItem|null;stock:number|null};

export function CostsManager({costs,items,stock,defaultPct,imports,canEdit}:Props){
 const router=useRouter();
 const [q,setQ]=useState(''),[view,setView]=useState('demand'),[limit,setLimit]=useState(300),[upload,setUpload]=useState(false),[notice,setNotice]=useState('');
 const [draft,setDraft]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pct,setPct]=useState(String(defaultPct));
 const rows=useMemo(()=>{const map=new Map<string,Row>();const stockMap=new Map(stock.map(s=>[s.material_code,s.free_stock]));
  for(const c of costs)map.set(c.material_code,{code:c.material_code,cost:c,item:null,stock:stockMap.get(c.material_code)??null});
  // Los modelos de la demanda siempre aparecen, aunque todavía no tengan costo.
  for(const i of items){const r=map.get(i.material_code)??{code:i.material_code,cost:null,item:null,stock:stockMap.get(i.material_code)??null};r.item=i;map.set(i.material_code,r);}
  return [...map.values()];},[costs,items,stock]);
 const filtered=useMemo(()=>{const t=q.trim().toUpperCase();return rows.filter(r=>(view==='all'||(view==='demand'?r.item?.active:view==='missing'?r.cost?.price===null||!r.cost:false))&&(!t||r.code.toUpperCase().includes(t)||(r.cost?.description??r.item?.description??'').toUpperCase().includes(t)))
  .sort((a,b)=>view==='demand'?(b.item?.monthly_demand??0)-(a.item?.monthly_demand??0):a.code.localeCompare(b.code));},[rows,q,view]);
 const demandRows=rows.filter(r=>r.item?.active);const withCost=demandRows.filter(r=>r.cost?.price!=null);
 const monthly=withCost.reduce((s,r)=>s+r.cost!.price!*(r.item!.monthly_demand),0);
 const holding=rows.reduce((s,r)=>{const ic=r.cost?inventoryCost(r.cost.price,r.cost.inventory_cost_pct,defaultPct):null;return ic!==null&&r.stock&&r.stock>0?s+ic*r.stock:s;},0);
 const open=(r?:Row)=>{setError('');const c=r?.cost;setDraft({isNew:!c,locked:!!r,material_code:r?.code??'',description:c?.description??r?.item?.description??'',price:c?.price??'',currency:c?.currency??'USD',price_updated_at:c?.price_updated_at??'',base_unit:c?.base_unit??'UN',inventory_cost_pct:c?.inventory_cost_pct??'',active:c?.active??true,notes:c?.notes??''});};
 async function save(){setBusy(true);setError('');try{await postJson('/api/masters',{action:'cost',...draft});setNotice(`Costo de ${draft.material_code} guardado.`);setDraft(null);router.refresh();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}
 async function savePct(){setBusy(true);try{await postJson('/api/masters',{action:'inventory-pct',value:pct});setNotice(`Costo de inventario general: ${pct} % del costo de producción.`);router.refresh();}catch(e){setNotice(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}

 return <>
  <div className="metrics compact">
   <div><span>Materiales con costo</span><strong>{n0.format(costs.filter(c=>c.price!==null).length)}</strong><small>de {n0.format(costs.length)} registrados</small></div>
   <div><span>Modelos de la demanda con costo</span><strong>{withCost.length} / {demandRows.length}</strong><small>{demandRows.length-withCost.length} pendientes de costo</small></div>
   <div><span>Costo de producción de la demanda</span><strong className="metric-text">{money.format(monthly)}</strong><small>por mes (costo × demanda mensual)</small></div>
   <div><span>Costo de mantener el inventario</span><strong className="metric-text">{money.format(holding)}</strong><small>stock actual × costo de inventario</small></div>
  </div>
  {notice&&<p className="alert" role="status">{notice} <button className="link-button" onClick={()=>setNotice('')}>Cerrar</button></p>}
  <div className="toolbar-row">{canEdit&&<button className="primary" onClick={()=>open()}><Plus size={16}/>Agregar costo</button>}{canEdit&&<button className={upload?'selected-tool':''} onClick={()=>setUpload(!upload)}><Upload size={16}/>Carga masiva desde SAP</button>}
   <span className="spacer"/><label className="inline-field">Costo de inventario general<input className="narrow" type="number" min="0" max="100" step="0.1" disabled={!canEdit} value={pct} onChange={e=>setPct(e.target.value)}/> % del costo de producción</label>{canEdit&&<button disabled={busy||pct===String(defaultPct)} onClick={savePct}>Guardar %</button>}</div>
  {upload&&<MasterUpload kind="COSTOS" title="Carga masiva de costos" columns={COST_COLUMNS} help="Sube el Excel de costos exportado de SAP. Los materiales nuevos se agregan y los existentes actualizan su precio y fecha; el % de inventario propio de cada material y las notas se conservan." onDone={m=>{setNotice(m);setUpload(false);router.refresh();}}/>}
  <section className="panel">
   <form className="filters" onSubmit={e=>e.preventDefault()}><label>Código SAP o texto breve<input value={q} onChange={e=>{setQ(e.target.value);setLimit(300);}} placeholder="Ej. 3C80595"/></label>
    <label>Mostrar<select value={view} onChange={e=>{setView(e.target.value);setLimit(300);}}><option value="demand">Colchones de la demanda</option><option value="missing">Sin costo</option><option value="all">Todos los materiales</option></select></label></form>
   <div className="table-scroll tall"><table><thead><tr><th>Material</th><th>Texto breve material</th><th>Última modificación</th><th className="number">Costo de producción</th><th>Moneda</th><th className="number">% inventario</th><th className="number">Costo de inventario / u</th><th className="number">Demanda mensual</th><th className="number">Costo producción mes</th><th className="number">Stock</th><th/></tr></thead>
    <tbody>{filtered.slice(0,limit).map(r=>{const c=r.cost;const ic=c?inventoryCost(c.price,c.inventory_cost_pct,defaultPct):null;return <tr key={r.code} className={c&&!c.active?'inactive-row':''}>
     <td className="mono">{r.code}</td><td>{c?.description??r.item?.description}{!c&&<span className="badge warning">Sin costo</span>}</td>
     <td>{day(c?.price_updated_at)}{c?.last_source==='MANUAL'&&<><br/><small className="muted">editado {when(c.updated_at)}</small></>}</td>
     <td className="number"><b>{c?.price==null?'—':unitMoney.format(c.price)}</b>{c?.base_unit&&<small className="muted"> /{c.base_unit}</small>}</td><td>{c?.currency??'—'}</td>
     <td className="number">{c?.inventory_cost_pct!=null?<b>{c.inventory_cost_pct} %</b>:<span className="muted">{defaultPct} %</span>}</td><td className="number">{ic===null?'—':unitMoney.format(ic)}</td>
     <td className="number">{r.item?n0.format(r.item.monthly_demand):'—'}</td><td className="number">{r.item&&c?.price!=null?money.format(c.price*r.item.monthly_demand):'—'}</td><td className="number">{r.stock===null?'—':n0.format(r.stock)}</td>
     <td className="row-actions">{canEdit&&<button className="compact-button" onClick={()=>open(r)}><Pencil size={14}/>{c?'Editar':'Agregar'}</button>}{c&&<HistoryButton table="material_costs" code={r.code} fields={['price','price_updated_at','inventory_cost_pct','description']}/>}</td></tr>;})}</tbody></table></div>
   <div className="pagination"><span>{filtered.length} materiales</span>{filtered.length>limit&&<button onClick={()=>setLimit(limit+500)}>Mostrar más</button>}</div>
  </section>
  <ImportLog rows={imports}/>
  {draft&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Editar costo"><div className="modal">
   <div className="section-heading"><div><p className="eyebrow">{draft.isNew?'NUEVO COSTO':'EDITAR COSTO'}</p><h2>{draft.material_code||'Material'}</h2></div><button className="icon-button" onClick={()=>setDraft(null)} aria-label="Cerrar"><X size={18}/></button></div>
   <div className="bom-form-grid">
    <label>Material (código SAP)<input value={draft.material_code} disabled={draft.locked} onChange={e=>setDraft({...draft,material_code:e.target.value})}/></label>
    <label>Última modificación<input type="date" value={draft.price_updated_at??''} onChange={e=>setDraft({...draft,price_updated_at:e.target.value})}/></label>
    <label className="span-2">Texto breve material<input value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    <label>Costo de producción (precio unitario)<input type="number" min="0" step="0.0001" value={draft.price} onChange={e=>setDraft({...draft,price:e.target.value})} autoFocus/></label>
    <label>Moneda<input value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value.toUpperCase()})}/></label>
    <label>Unidad<input value={draft.base_unit??''} onChange={e=>setDraft({...draft,base_unit:e.target.value.toUpperCase()})}/></label>
    <label>% costo de inventario propio<input type="number" min="0" max="100" step="0.1" value={draft.inventory_cost_pct} placeholder={`${defaultPct} (general)`} onChange={e=>setDraft({...draft,inventory_cost_pct:e.target.value})}/><small className="muted">Vacío = usa el {defaultPct} % general. Costo de inventario = {draft.price!==''?unitMoney.format(Number(draft.price)*Number(draft.inventory_cost_pct===''?defaultPct:draft.inventory_cost_pct)/100):'—'} por unidad.</small></label>
    <label className="inline-check"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Activo</label>
    <label className="span-2">Notas<input value={draft.notes??''} onChange={e=>setDraft({...draft,notes:e.target.value})} placeholder="Motivo del cambio (opcional)"/></label>
   </div>
   {error&&<p className="alert error">{error}</p>}
   <div className="toolbar-row end"><button onClick={()=>setDraft(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar'}</button></div>
  </div></div>}
 </>;
}
