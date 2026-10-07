'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { buildCalendar, type Area, type AttendanceDay, type AttendanceMonth, type DemandItem, type WeekDay, type WorkDayException } from '@/lib/planning';
import { areaLoad, hoursPerUnit, ROUTING_COLUMNS, summarizeRoutes, type Operation, type WorkCenter } from '@/lib/masters';
import { day, HistoryButton, ImportLog, MasterUpload, postJson } from './master-tools';

type Config={areas:Area[];week:WeekDay[];exceptions:WorkDayException[];monthAttendance:AttendanceMonth[];dayAttendance:AttendanceDay[];referenceHours:number};
type Props={initialCode:string;ops:Operation[];centers:WorkCenter[];items:DemandItem[];month:string;costs:{material_code:string;price:number|null}[];stock:{material_code:string;free_stock:number;stock_date:string}[];config:Config;imports:any[];canEdit:boolean};
const n0=new Intl.NumberFormat('es-EC',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('es-EC',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('es-EC',{maximumFractionDigits:2}),n4=new Intl.NumberFormat('es-EC',{maximumFractionDigits:4}),money=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:2});
const minutes=(h:number)=>n1.format(h*60);

export function RoutingsManager({initialCode,ops,centers,items,month,costs,stock,config,imports,canEdit}:Props){
 const router=useRouter();
 const routes=useMemo(()=>summarizeRoutes(ops),[ops]);
 const [code,setCode]=useState(initialCode),[query,setQuery]=useState(initialCode),[upload,setUpload]=useState(false),[notice,setNotice]=useState(''),[tab,setTab]=useState('models'),[limit,setLimit]=useState(200),[filter,setFilter]=useState('');
 const [draft,setDraft]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const calendar=useMemo(()=>buildCalendar(month,config.week,config.exceptions,config.areas,config.monthAttendance,config.dayAttendance),[month,config]);
 const load=useMemo(()=>areaLoad(items,routes,centers,config.areas,calendar),[items,routes,centers,config.areas,calendar]);
 const itemMap=useMemo(()=>new Map(items.map(i=>[i.material_code,i])),[items]);
 const allCodes=useMemo(()=>[...new Set([...items.map(i=>i.material_code),...routes.keys()])].sort(),[items,routes]);
 const centerName=(c:string|null)=>c?centers.find(x=>x.code===c)?.name??c:'—';
 const areaOf=(c:string|null)=>config.areas.find(a=>a.id===centers.find(x=>x.code===c)?.area_id)?.name??null;

 const find=(c:string)=>{const v=c.trim().toUpperCase();setCode(v);setQuery(v);window.history.replaceState(null,'',v?`/routings?code=${encodeURIComponent(v)}`:'/routings');};
 const route=code?routes.get(code)??routes.get(allCodes.find(c=>c.toUpperCase()===code)??''):undefined;
 const item=code?itemMap.get(code):undefined;const cost=costs.find(c=>c.material_code===code);const st=stock.find(s=>s.material_code===code);
 const allOps=code?ops.filter(o=>o.material_code===code).sort((a,b)=>a.route_counter.localeCompare(b.route_counter)||a.operation.localeCompare(b.operation)):[];

 const models=useMemo(()=>{const t=filter.trim().toUpperCase();return items.filter(i=>i.active).map(i=>({i,r:routes.get(i.material_code)})).filter(x=>!t||x.i.material_code.includes(t)||x.i.description.toUpperCase().includes(t)).sort((a,b)=>b.i.monthly_demand-a.i.monthly_demand);},[items,routes,filter]);
 const totalHours=models.reduce((s,m)=>s+(m.r?m.r.hours*m.i.monthly_demand:0),0);

 const openOp=(o?:Operation)=>{setError('');const last=allOps.filter(x=>x.route_counter===(route?.route_counter??'1')).at(-1);
  setDraft(o?{...o}:{material_code:code,route_counter:route?.route_counter??'1',operation:String((Number(last?.operation??0)+10)).padStart(4,'0'),route_description:route?.description??item?.description??'',control_key:'ZPP1',base_quantity:1,op_unit:'UN',standard_value:0,standard_unit:'H',operation_text:'',work_center:'',active:true,notes:''});};
 async function act(body:any,ok:string){setBusy(true);setError('');try{await postJson('/api/masters',body);setNotice(ok);setDraft(null);router.refresh();return true;}catch(e){setError(e instanceof Error?e.message:'Error');return false;}finally{setBusy(false);}}

 return <>
  <section className="panel lookup">
   <form className="filters" onSubmit={e=>{e.preventDefault();find(query);}}><label>Código SAP del colchón o material<input list="routing-codes" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ej. 3C80595" autoFocus={!initialCode}/></label><datalist id="routing-codes">{allCodes.slice(0,3000).map(c=><option key={c} value={c}>{itemMap.get(c)?.description??routes.get(c)?.description??''}</option>)}</datalist><button className="primary"><Search size={16}/>Ver procesos</button>{code&&<button type="button" onClick={()=>find('')}>Limpiar</button>}</form>
   {code&&<>
    <div className="model-sheet">
     <div><span>Modelo</span><b>{item?.description??route?.description??'Sin descripción'}</b><small className="mono">{code}</small></div>
     <div><span>Tipo</span><b>{item?<><span className="code-chip">{item.mattress_type}</span><span className="code-chip panel">{item.panel_type}</span> {item.size_cm??''}</>:'—'}</b><small>colchón · panel · medida</small></div>
     <div><span>Demanda mensual</span><b>{item?n0.format(item.monthly_demand):'—'}</b><small>{item&&route?`${n1.format(route.hours*item.monthly_demand)} h de trabajo al mes`:''}</small></div>
     <div><span>Costo de producción</span><b>{cost?.price!=null?money.format(cost.price):'—'}</b><small>módulo Costos</small></div>
     <div><span>Inventario</span><b>{st?n2.format(st.free_stock):'—'}</b><small>{st?`al ${day(st.stock_date)}`:'módulo Inventario'}</small></div>
     <div className="highlight"><span>Tiempo total por unidad</span><b>{route?`${minutes(route.hours)} min`:'—'}</b><small>{route?`${n4.format(route.hours)} h · ${route.operations.length} operaciones`:'sin hoja de ruta'}</small></div>
    </div>
    {!route&&!allOps.length&&<p className="alert">Este código no tiene hoja de ruta cargada. {canEdit&&'Puedes agregar sus operaciones manualmente o subir el Excel de hojas de ruta.'}</p>}
    {allOps.length>0&&<div className="table-scroll"><table><thead><tr><th>Hoja</th><th>Operación</th><th>Texto breve operación</th><th>Puesto de trabajo</th><th>Área</th><th className="number">Valor prefijado</th><th className="number">Cantidad base</th><th className="number">Horas / unidad</th><th className="number">Minutos / unidad</th><th/></tr></thead>
     <tbody>{allOps.map(o=>{const h=hoursPerUnit(o);const main=o.route_counter===route?.route_counter;return <tr key={o.id} className={main&&o.active?'':'inactive-row'}>
      <td>{o.route_counter}</td><td className="mono">{o.operation}</td><td>{o.operation_text}</td><td><span className="mono">{o.work_center??'—'}</span><br/><small className="muted">{centerName(o.work_center)}</small></td><td>{areaOf(o.work_center)??<span className="muted">Sin área</span>}</td>
      <td className="number">{n4.format(o.standard_value)} {o.standard_unit}</td><td className="number">{n2.format(o.base_quantity)} {o.op_unit}</td><td className="number">{n4.format(h)}</td><td className="number"><b>{minutes(h)}</b></td>
      <td className="row-actions">{canEdit&&<button className="compact-button" onClick={()=>openOp(o)}><Pencil size={14}/>Editar</button>}</td></tr>;})}</tbody>
     {route&&<tfoot><tr><td colSpan={7}>Total hoja de ruta {route.route_counter}{route.counters.length>1&&` (hay ${route.counters.length} hojas; se usa la ${route.route_counter})`}</td><td className="number">{n4.format(route.hours)}</td><td className="number">{minutes(route.hours)} min</td><td/></tr></tfoot>}</table></div>}
    <div className="toolbar-row">{canEdit&&<button onClick={()=>openOp()}><Plus size={16}/>Agregar operación</button>}<HistoryButton table="routing_operations" code={code} fields={['operation','operation_text','work_center','standard_value','standard_unit','base_quantity']}/><span className="muted">Historial de cambios de esta hoja de ruta</span></div>
   </>}
  </section>
  {notice&&<p className="alert" role="status">{notice} <button className="link-button" onClick={()=>setNotice('')}>Cerrar</button></p>}
  <div className="toolbar-row">{canEdit&&<button className={upload?'selected-tool':''} onClick={()=>setUpload(!upload)}><Upload size={16}/>Carga masiva de hojas de ruta</button>}</div>
  {upload&&<MasterUpload kind="RUTAS" title="Carga masiva de hojas de ruta" columns={ROUTING_COLUMNS} help="Sube el Excel de hojas de ruta exportado de SAP. Para cada material del archivo su hoja de ruta se reemplaza por la del archivo (se agregan, actualizan o retiran operaciones); los materiales que no vienen se conservan." onDone={m=>{setNotice(m);setUpload(false);router.refresh();}}/>}
  <div className="tabs" role="tablist">{[['models','Tiempos por colchón'],['load','Carga por área del mes'],['centers','Puestos de trabajo']].map(([k,l])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}</div>
  {tab==='models'&&<section className="panel"><div className="section-heading"><div><h2>Tiempo de elaboración de los colchones de la demanda</h2><p>Tiempo total por unidad (suma de todas las operaciones) y horas de trabajo que exige la demanda mensual: {n0.format(totalHours)} h en total.</p></div><label>Filtrar<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Código o nombre"/></label></div>
   <div className="table-scroll tall"><table><thead><tr><th>Material</th><th>Descripción</th><th>Tipo</th><th className="number">Operaciones</th><th className="number">Min / unidad</th><th className="number">Demanda mensual</th><th className="number">Horas al mes</th><th/></tr></thead>
    <tbody>{models.slice(0,limit).map(({i,r})=><tr key={i.material_code}><td className="mono">{i.material_code}</td><td>{i.description}</td><td><span className="code-chip">{i.mattress_type}</span><span className="code-chip panel">{i.panel_type}</span></td>
     <td className="number">{r?r.operations.length:<span className="badge warning">Sin hoja de ruta</span>}</td><td className="number"><b>{r?minutes(r.hours):'—'}</b></td><td className="number">{n0.format(i.monthly_demand)}</td><td className="number">{r?n1.format(r.hours*i.monthly_demand):'—'}</td>
     <td><button className="compact-button" onClick={()=>{find(i.material_code);window.scrollTo({top:0,behavior:'smooth'});}}>Ver procesos</button></td></tr>)}</tbody></table></div>
   {models.length>limit&&<div className="pagination"><button onClick={()=>setLimit(limit+300)}>Mostrar más</button></div>}
   {!items.length&&<p className="alert">Carga la demanda para ver el tiempo de los colchones que se deben producir.</p>}
  </section>}
  {tab==='load'&&<section className="panel"><h2>Horas que exige la demanda por área</h2>
   <p>Demanda mensual × tiempo de cada operación, agrupado por el área del puesto de trabajo, contra las horas-persona disponibles del mes (personal × horas del calendario × asistencia, del módulo Restricciones).</p>
   <div className="capacity-bars">{load.rows.map(r=>{const pct=r.usage??0;const over=pct>1;return <div key={r.areaName} className="capacity-row">
    <div><b>{r.areaName}</b><small className="muted">{r.centers.map(centerName).join(', ')}</small></div>
    {r.available?<div className="bar-track" title={`${n0.format(r.required)} h requeridas / ${n0.format(r.available)} h disponibles`}><div className={`bar-fill ${over?'over':''}`} style={{width:`${Math.min(100,pct*100/1.5)}%`}}/><div className="bar-limit" style={{left:`${100/1.5}%`}}/></div>:<div className="muted">{r.area?'Falta el personal del área':'Asigna un área a estos puestos en la pestaña Puestos de trabajo'}</div>}
    <div className="number"><b>{n0.format(r.required)} h</b>{r.available!==null&&<> / {n0.format(r.available)} h<br/><small className={over?'text-error':'muted'}>{n0.format(pct*100)} % de las horas disponibles</small></>}</div></div>;})}</div>
   {load.missing.length>0&&<p className="footnote">{load.missing.length} modelos con demanda no tienen hoja de ruta, así que su tiempo no está incluido: {load.missing.slice(0,15).map(m=>m.material_code).join(', ')}{load.missing.length>15?'…':''}</p>}
  </section>}
  {tab==='centers'&&<CentersPanel centers={centers} areas={config.areas} ops={ops} canEdit={canEdit} act={act}/>}
  {tab==='centers'&&error&&!draft&&<p className="alert error">{error}</p>}
  <ImportLog rows={imports}/>
  {draft&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Editar operación"><div className="modal">
   <div className="section-heading"><div><p className="eyebrow">{draft.id?'EDITAR OPERACIÓN':'NUEVA OPERACIÓN'}</p><h2>{draft.material_code} · {draft.operation}</h2></div><button className="icon-button" onClick={()=>setDraft(null)} aria-label="Cerrar"><X size={18}/></button></div>
   <div className="bom-form-grid">
    <label>Número de operación<input value={draft.operation} onChange={e=>setDraft({...draft,operation:e.target.value})}/></label>
    <label>Hoja de ruta (contador)<input value={draft.route_counter} onChange={e=>setDraft({...draft,route_counter:e.target.value})}/></label>
    <label>Texto breve operación<input value={draft.operation_text??''} onChange={e=>setDraft({...draft,operation_text:e.target.value.toUpperCase()})} placeholder="Ej. TAPIZADO"/></label>
    <label>Puesto de trabajo<input list="work-centers" value={draft.work_center??''} onChange={e=>setDraft({...draft,work_center:e.target.value.toUpperCase()})}/><datalist id="work-centers">{centers.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</datalist></label>
    <label>Valor prefijado (tiempo)<input type="number" min="0" step="0.0001" value={draft.standard_value} onChange={e=>setDraft({...draft,standard_value:e.target.value})} autoFocus/></label>
    <label>Unidad de tiempo<select value={draft.standard_unit} onChange={e=>setDraft({...draft,standard_unit:e.target.value})}><option value="H">Horas (H)</option><option value="MIN">Minutos</option><option value="S">Segundos</option></select></label>
    <label>Cantidad base<input type="number" min="0" step="0.0001" value={draft.base_quantity} onChange={e=>setDraft({...draft,base_quantity:e.target.value})}/><small className="muted">El tiempo corresponde a esta cantidad. Tiempo por unidad: {minutes(hoursPerUnit({standard_value:Number(draft.standard_value)||0,standard_unit:draft.standard_unit,base_quantity:Number(draft.base_quantity)||1}))} min.</small></label>
    <label>Unidad de la operación<input value={draft.op_unit??''} onChange={e=>setDraft({...draft,op_unit:e.target.value.toUpperCase()})}/></label>
    <label>Clave de control<input value={draft.control_key??''} onChange={e=>setDraft({...draft,control_key:e.target.value.toUpperCase()})}/></label>
    <label className="inline-check"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Operación activa (inactiva = no suma al tiempo)</label>
    <label className="span-2">Notas<input value={draft.notes??''} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
   </div>
   {error&&<p className="alert error">{error}</p>}
   <div className="toolbar-row">{draft.id&&<button disabled={busy} onClick={()=>confirm(`¿Eliminar la operación ${draft.operation} de ${draft.material_code}? Queda registrada en el historial.`)&&act({action:'operation-delete',id:draft.id},'Operación eliminada.')}><Trash2 size={15}/>Eliminar</button>}<span className="spacer"/><button onClick={()=>setDraft(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={()=>act({action:'operation',...draft},`Operación ${draft.operation} de ${draft.material_code} guardada.`)}>{busy?'Guardando…':'Guardar'}</button></div>
  </div></div>}
 </>;
}

function CentersPanel({centers,areas,ops,canEdit,act}:{centers:WorkCenter[];areas:Area[];ops:Operation[];canEdit:boolean;act:(b:any,ok:string)=>Promise<boolean>}){
 const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(centers.map(c=>[c.code,c.area_id?String(c.area_id):''])));
 const usage=useMemo(()=>{const m=new Map<string,Set<string>>();for(const o of ops)if(o.work_center){const s=m.get(o.work_center)??new Set();s.add(o.material_code);m.set(o.work_center,s);}return m;},[ops]);
 const sorted=[...centers].sort((a,b)=>(usage.get(b.code)?.size??0)-(usage.get(a.code)?.size??0));
 return <section className="panel"><h2>Puestos de trabajo y su área</h2><p>Asigna cada puesto de SAP a un área de producción (Tapicería, Cerrado, Marcos, Sellado…). Así el tiempo de las hojas de ruta se compara con el personal y la asistencia de cada área.</p>
  <div className="table-scroll tall"><table><thead><tr><th>Puesto</th><th>Operación</th><th className="number">Materiales</th><th>Área</th><th/></tr></thead>
   <tbody>{sorted.map(c=><tr key={c.code}><td className="mono">{c.code}</td><td>{c.name}</td><td className="number">{usage.get(c.code)?.size??0}</td>
    <td><select disabled={!canEdit} value={values[c.code]??''} onChange={e=>setValues({...values,[c.code]:e.target.value})}><option value="">Sin área</option>{areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></td>
    <td>{canEdit&&(values[c.code]??'')!==(c.area_id?String(c.area_id):'')&&<button className="compact-button primary" onClick={()=>act({action:'work-center',code:c.code,name:c.name,area_id:values[c.code]||null},`Puesto ${c.code} asignado.`)}>Guardar</button>}</td></tr>)}</tbody></table></div>
 </section>;
}
