'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, Pencil, Plus, Tags, Upload, X } from 'lucide-react';
import { DEMAND_COLUMNS, type DemandItem, type PlanningCode } from '@/lib/planning';

type ImportRow={id:number;file_name:string;created_at:string;total_rows:number;inserted_rows:number;updated_rows:number;unchanged_rows:number};
type Missing={code:string;description:string;size:number|null};
type Props={items:DemandItem[];codes:PlanningCode[];imports:ImportRow[];withoutDemand:Missing[];canEdit:boolean};
type Draft={material_code:string;description:string;mattress_type:string;panel_type:string;size_cm:string;monthly_demand:string;active:boolean;notes:string};
const fmt=new Intl.NumberFormat('es-EC',{maximumFractionDigits:2});
const when=(iso?:string)=>iso?new Date(iso).toLocaleString('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'short'}):'—';
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});

async function post(url:string,body:unknown){const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error??'No se pudo guardar.');return data;}

export function DemandManager({items,codes,imports,withoutDemand,canEdit}:Props){
 const router=useRouter();
 const mattress=codes.filter(c=>c.kind==='COLCHON'),panels=codes.filter(c=>c.kind==='PANEL');
 const name=(kind:string,code:string)=>codes.find(c=>c.kind===kind&&c.code===code)?.name??code;
 const [q,setQ]=useState(''),[type,setType]=useState(''),[panel,setPanel]=useState(''),[size,setSize]=useState(''),[status,setStatus]=useState('active');
 const [tool,setTool]=useState<''|'upload'|'report'|'codes'|'missing'>('');
 const [draft,setDraft]=useState<Draft|null>(null),[isNew,setIsNew]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const sizes=useMemo(()=>[...new Set(items.map(i=>i.size_cm).filter((s):s is number=>s!==null))].sort((a,b)=>a-b),[items]);
 const rows=useMemo(()=>{const t=q.trim().toUpperCase();return items.filter(i=>(!t||i.material_code.toUpperCase().includes(t)||i.description.toUpperCase().includes(t))&&(!type||i.mattress_type===type)&&(!panel||i.panel_type===panel)&&(!size||String(i.size_cm)===size)&&(status==='all'||(status==='active'?i.active:status==='demand'?i.active&&i.monthly_demand>0:!i.active)));},[items,q,type,panel,size,status]);
 const active=items.filter(i=>i.active);const total=active.reduce((s,i)=>s+i.monthly_demand,0);
 const byType=mattress.map(c=>({c,sum:active.filter(i=>i.mattress_type===c.code).reduce((s,i)=>s+i.monthly_demand,0),n:active.filter(i=>i.mattress_type===c.code).length}));
 const byPanel=panels.map(c=>({c,sum:active.filter(i=>i.panel_type===c.code).reduce((s,i)=>s+i.monthly_demand,0)}));

 const open=(i?:DemandItem,preset?:Partial<Draft>)=>{setError('');setIsNew(!i);setDraft(i?{material_code:i.material_code,description:i.description,mattress_type:i.mattress_type,panel_type:i.panel_type,size_cm:i.size_cm===null?'':String(i.size_cm),monthly_demand:String(i.monthly_demand),active:i.active,notes:i.notes??''}:{material_code:'',description:'',mattress_type:mattress[0]?.code??'T',panel_type:'NP',size_cm:'',monthly_demand:'0',active:true,notes:'',...preset});};
 async function save(){if(!draft)return;setBusy(true);setError('');try{await post('/api/demand',{action:'save',isNew,item:draft});setNotice(isNew?`Modelo ${draft.material_code} agregado.`:`Cambios de ${draft.material_code} guardados. Quedó registrado en el historial.`);setDraft(null);router.refresh();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}

 return <>
  <div className="metrics compact">
   <div><span>Modelos activos</span><strong>{active.length}</strong><small>{active.filter(i=>i.monthly_demand>0).length} con demanda este periodo</small></div>
   <div><span>Demanda mensual total</span><strong>{fmt.format(total)}</strong><small>unidades / mes</small></div>
   <div><span>Por tipo de colchón</span><p className="type-split">{byType.filter(x=>x.n).map(x=><span key={x.c.code} title={x.c.name}><b className="code-chip">{x.c.code}</b>{fmt.format(x.sum)}</span>)}</p></div>
   <div><span>Por tipo de panel</span><p className="type-split">{byPanel.filter(x=>x.sum).map(x=><span key={x.c.code} title={x.c.name}><b className="code-chip panel">{x.c.code}</b>{fmt.format(x.sum)}</span>)}</p></div>
  </div>
  {notice&&<p className="alert" role="status">{notice} <button className="link-button" onClick={()=>setNotice('')}>Cerrar</button></p>}
  <div className="toolbar-row">
   {canEdit&&<button className="primary" onClick={()=>open()}><Plus size={16}/>Nuevo modelo</button>}
   {canEdit&&<button className={tool==='upload'?'selected-tool':''} onClick={()=>setTool(tool==='upload'?'':'upload')}><Upload size={16}/>Carga masiva</button>}
   <button className={tool==='report'?'selected-tool':''} onClick={()=>setTool(tool==='report'?'':'report')}><Download size={16}/>Descargar reporte</button>
   <button className={tool==='codes'?'selected-tool':''} onClick={()=>setTool(tool==='codes'?'':'codes')}><Tags size={16}/>Letras de tipo</button>
   {withoutDemand.length>0&&<button className={tool==='missing'?'selected-tool':''} onClick={()=>setTool(tool==='missing'?'':'missing')}>Modelos del catálogo sin demanda ({withoutDemand.length})</button>}
  </div>
  {tool==='upload'&&<BulkUpload onDone={msg=>{setNotice(msg);setTool('');router.refresh();}}/>}
  {tool==='report'&&<ReportPanel/>}
  {tool==='codes'&&<CodesPanel codes={codes} canEdit={canEdit} onSaved={()=>router.refresh()}/>}
  {tool==='missing'&&<section className="panel"><h2>Modelos del catálogo sin demanda</h2><p>Productos con código SAP en el catálogo existente que todavía no tienen fila de demanda. Agregarlos no modifica el catálogo.</p><div className="table-scroll short"><table><thead><tr><th>Material</th><th>Descripción</th><th className="number">Medida</th><th/></tr></thead><tbody>{withoutDemand.map(m=><tr key={m.code}><td className="mono">{m.code}</td><td>{m.description}</td><td className="number">{m.size??'—'}</td><td>{canEdit&&<button className="compact-button" onClick={()=>open(undefined,{material_code:m.code,description:m.description,size_cm:m.size===null?'':String(m.size)})}>Agregar demanda</button>}</td></tr>)}</tbody></table></div></section>}

  <section className="panel">
   <form className="filters" onSubmit={e=>e.preventDefault()}>
    <label>Código o descripción<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ej. 3C80595 o SONATA"/></label>
    <label>Tipo de colchón<select value={type} onChange={e=>setType(e.target.value)}><option value="">Todos</option>{mattress.map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label>
    <label>Tipo de panel<select value={panel} onChange={e=>setPanel(e.target.value)}><option value="">Todos</option>{panels.map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label>
    <label>Medida<select value={size} onChange={e=>setSize(e.target.value)}><option value="">Todas</option>{sizes.map(s=><option key={s} value={String(s)}>{s}</option>)}</select></label>
    <label>Estado<select value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Activos</option><option value="demand">Con demanda &gt; 0</option><option value="inactive">Inactivos</option><option value="all">Todos</option></select></label>
   </form>
   {!items.length?<div className="empty-state"><FileSpreadsheet size={28}/><p>Aún no hay demanda registrada. Usa <b>Carga masiva</b> con tu Excel DEMANDAS.LAMITEX para cargar todos los modelos de una vez.</p></div>:
   <div className="table-scroll tall"><table><thead><tr>{DEMAND_COLUMNS.map((c,i)=><th key={c} className={i>=4?'number':''}>{c}</th>)}<th>Actualizado</th><th/></tr></thead>
    <tbody>{rows.map(i=><tr key={i.material_code} className={i.active?'':'inactive-row'}>
     <td className="mono">{i.material_code}</td><td>{i.description}{!i.active&&<span className="badge warning">Inactivo</span>}</td>
     <td><span className="code-chip" title={name('COLCHON',i.mattress_type)}>{i.mattress_type}</span> <small className="muted">{name('COLCHON',i.mattress_type)}</small></td>
     <td><span className="code-chip panel" title={name('PANEL',i.panel_type)}>{i.panel_type}</span> <small className="muted">{name('PANEL',i.panel_type)}</small></td>
     <td className="number">{i.size_cm??'—'}</td><td className="number"><b>{fmt.format(i.monthly_demand)}</b></td>
     <td><small>{when(i.updated_at)}<br/><span className="muted">{i.last_source==='CARGA_MASIVA'?'Carga masiva':'Manual'}</span></small></td>
     <td>{canEdit&&<button className="compact-button" onClick={()=>open(i)} aria-label={`Editar ${i.material_code}`}><Pencil size={14}/>Editar</button>}</td></tr>)}</tbody>
    <tfoot><tr><td colSpan={5}>{rows.length} modelos mostrados</td><td className="number"><b>{fmt.format(rows.filter(r=>r.active).reduce((s,r)=>s+r.monthly_demand,0))}</b></td><td colSpan={2}/></tr></tfoot></table></div>}
  </section>
  {imports.length>0&&<section className="panel"><h2>Últimas cargas masivas</h2><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Archivo</th><th className="number">Filas</th><th className="number">Nuevos</th><th className="number">Actualizados</th><th className="number">Sin cambio</th></tr></thead><tbody>{imports.map(i=><tr key={i.id}><td>{when(i.created_at)}</td><td>{i.file_name}</td><td className="number">{i.total_rows}</td><td className="number">{i.inserted_rows}</td><td className="number">{i.updated_rows}</td><td className="number">{i.unchanged_rows}</td></tr>)}</tbody></table></div></section>}

  {draft&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={isNew?'Nuevo modelo':'Editar demanda'} onKeyDown={e=>e.key==='Escape'&&setDraft(null)}>
   <div className="modal">
    <div className="section-heading"><div><p className="eyebrow">{isNew?'NUEVO MODELO':'EDITAR DEMANDA'}</p><h2>{isNew?'Agregar modelo con demanda':draft.material_code}</h2></div><button className="icon-button" onClick={()=>setDraft(null)} aria-label="Cerrar"><X size={18}/></button></div>
    <div className="bom-form-grid">
     <label>Material (código SAP)<input value={draft.material_code} disabled={!isNew} onChange={e=>setDraft({...draft,material_code:e.target.value})} autoFocus={isNew}/></label>
     <label>Medida<input type="number" min="0" step="1" value={draft.size_cm} onChange={e=>setDraft({...draft,size_cm:e.target.value})}/></label>
     <label className="span-2">Descripción del material<input value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
     <label>Tipo de colchón<select value={draft.mattress_type} onChange={e=>setDraft({...draft,mattress_type:e.target.value})}>{mattress.filter(c=>c.active||c.code===draft.mattress_type).map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label>
     <label>Tipo de panel<select value={draft.panel_type} onChange={e=>setDraft({...draft,panel_type:e.target.value})}>{panels.filter(c=>c.active||c.code===draft.panel_type).map(c=><option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></label>
     <label>Promedio venta mensual (volumen)<input type="number" min="0" step="1" value={draft.monthly_demand} onChange={e=>setDraft({...draft,monthly_demand:e.target.value})} autoFocus={!isNew}/></label>
     <label className="inline-check"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Modelo activo (si lo desactivas no se borra; deja de contar en la demanda)</label>
     <label className="span-2">Notas<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})} placeholder="Motivo del cambio (opcional)"/></label>
    </div>
    {error&&<p className="alert error" role="alert">{error}</p>}
    <div className="toolbar-row end"><button onClick={()=>setDraft(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar'}</button></div>
   </div></div>}
 </>;
}

function BulkUpload({onDone}:{onDone:(msg:string)=>void}){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(confirm:boolean){if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.set('file',file);if(confirm){form.set('confirm','yes');form.set('hash',preview.hash);}
  const res=await fetch('/api/demand/import',{method:'POST',body:form});const data=await res.json();if(!res.ok)throw new Error(data.error);
  if(confirm)onDone(`Carga masiva aplicada: ${data.inserted} modelos nuevos, ${data.updated} actualizados y ${data.unchanged} sin cambio.`);else setPreview(data);}
  catch(e){setError(e instanceof Error?e.message:'Error al cargar.');}finally{setBusy(false);}}
 return <section className="panel">
  <h2>Carga masiva de demanda</h2>
  <p>Sube un Excel con las mismas columnas de DEMANDAS.LAMITEX: <b>{DEMAND_COLUMNS.join(' · ')}</b>. Los modelos nuevos se agregan, los existentes se actualizan y los que no vienen en el archivo se mantienen igual. Primero verás un resumen; nada se guarda hasta que confirmes.</p>
  <p><a className="button" href="/api/demand/report?template=empty"><FileSpreadsheet size={16}/>Plantilla vacía</a> <a className="button" href="/api/demand/report?template=current"><FileSpreadsheet size={16}/>Demanda vigente para editar en Excel</a></p>
  <label>Archivo Excel (.xlsx)<input type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setError('');}}/></label>
  <p><button disabled={!file||busy} onClick={()=>submit(false)}>{busy&&!preview?'Validando…':'Validar archivo'}</button></p>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {preview&&<>
   <div className="metrics compact"><div><span>Filas válidas</span><strong>{preview.total}</strong></div><div><span>Modelos nuevos</span><strong>{preview.inserted}</strong></div><div><span>Con cambios</span><strong>{preview.updated}</strong></div><div><span>Sin cambio</span><strong>{preview.unchanged}</strong></div></div>
   {preview.errors.map((e:string,i:number)=><p className="alert error" key={i}>{e}</p>)}
   {preview.warnings.length>0&&<details><summary>{preview.warnings.length} avisos (no bloquean la carga)</summary>{preview.warnings.map((w:string,i:number)=><p className="footnote" key={i}>{w}</p>)}</details>}
   {preview.changes.length>0&&<div className="table-scroll short"><table><thead><tr><th>Material</th><th>Descripción</th><th>Resultado</th><th>Cambios</th></tr></thead><tbody>{preview.changes.map((c:any)=><tr key={c.material_code}><td className="mono">{c.material_code}</td><td>{c.description}</td><td><span className={`badge ${c.status==='NUEVO'?'':'warning'}`}>{c.status==='NUEVO'?'Nuevo':'Cambia'}</span></td><td>{c.changes.join(' · ')}</td></tr>)}</tbody></table></div>}
   <p><button className="primary" disabled={busy||preview.errors.length>0||preview.inserted+preview.updated===0} onClick={()=>submit(true)}>{busy?'Aplicando…':`Confirmar carga (${preview.inserted+preview.updated} cambios)`}</button></p>
   {preview.inserted+preview.updated===0&&!preview.errors.length&&<p className="muted">El archivo no trae cambios respecto a la demanda actual.</p>}
  </>}
 </section>;
}

function ReportPanel(){
 const t=today();const [from,setFrom]=useState(t.slice(0,8)+'01'),[to,setTo]=useState(t);
 const valid=from&&to&&from<=to;
 return <section className="panel"><h2>Reporte de demanda por fechas</h2>
  <p>Descarga un Excel con tres hojas: la demanda tal como estaba al cierre de la fecha <b>hasta</b>, la comparación contra el inicio de la fecha <b>desde</b>, y cada cambio (manual o por carga masiva) realizado entre ambas fechas.</p>
  <div className="filters"><label>Desde<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta<input type="date" value={to} max={t} onChange={e=>setTo(e.target.value)}/></label>
   {valid?<a className="button primary" href={`/api/demand/report?from=${from}&to=${to}`}><Download size={16}/>Descargar Excel</a>:<button disabled>Descargar Excel</button>}</div>
  <p className="footnote">El historial empieza con la primera carga en el ERP: fechas anteriores a esa carga no tienen datos.</p>
 </section>;
}

function CodesPanel({codes,canEdit,onSaved}:{codes:PlanningCode[];canEdit:boolean;onSaved:()=>void}){
 const [form,setForm]=useState({kind:'COLCHON',code:'',name:'',active:true}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function save(c=form){setBusy(true);setError('');try{await post('/api/demand',{action:'code',...c,sort:codes.filter(x=>x.kind===c.kind).length+1});setForm({kind:c.kind,code:'',name:'',active:true});onSaved();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}
 return <section className="panel"><h2>Letras de tipo de colchón y de panel</h2>
  <p>Estas letras son las que acepta la carga masiva y las que usan las restricciones de capacidad. Puedes agregar letras nuevas o cambiar su significado; desactivar una letra no cambia los modelos que ya la usan.</p>
  <div className="two-columns">{(['COLCHON','PANEL'] as const).map(kind=><div key={kind}><h3>{kind==='COLCHON'?'Tipo de colchón':'Tipo de panel'}</h3><table><tbody>{codes.filter(c=>c.kind===kind).map(c=><tr key={c.code} className={c.active?'':'inactive-row'}><td><span className={`code-chip ${kind==='PANEL'?'panel':''}`}>{c.code}</span></td><td>{c.name}</td><td>{canEdit&&<button className="compact-button" disabled={busy} onClick={()=>setForm({kind,code:c.code,name:c.name,active:c.active})}>Editar</button>}</td></tr>)}</tbody></table></div>)}</div>
  {canEdit&&<div className="filters"><label>Grupo<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="COLCHON">Tipo de colchón</option><option value="PANEL">Tipo de panel</option></select></label><label>Letra<input value={form.code} maxLength={4} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})}/></label><label>Significado<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label className="inline-check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>Activa</label><button className="primary" disabled={busy||!form.code||!form.name} onClick={()=>save()}>Guardar letra</button></div>}
  {error&&<p className="alert error">{error}</p>}
 </section>;
}
