'use client';
import { useEffect, useState } from 'react';
import { History, X } from 'lucide-react';

export const when=(iso?:string|null)=>iso?new Date(iso).toLocaleString('es-EC',{timeZone:'America/Guayaquil',dateStyle:'short',timeStyle:'short'}):'—';
export const day=(d?:string|null)=>d?new Date(d+'T12:00:00Z').toLocaleDateString('es-EC',{timeZone:'UTC'}):'—';
export const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
export async function postJson(url:string,body:unknown){const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error??'No se pudo guardar.');return data;}

/** Carga masiva común: valida, muestra el resumen y solo guarda al confirmar. */
export function MasterUpload({kind,title,columns,help,onDone}:{kind:'COSTOS'|'INVENTARIO'|'RUTAS';title:string;columns:string[];help:string;onDone:(msg:string)=>void}){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[snapshot,setSnapshot]=useState(today());
 async function submit(confirm:boolean){if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.set('file',file);form.set('kind',kind);form.set('snapshot',snapshot);if(confirm){form.set('confirm','yes');form.set('hash',preview.hash);}
  const res=await fetch('/api/masters/import',{method:'POST',body:form});const data=await res.json();if(!res.ok)throw new Error(data.error);
  if(confirm)onDone(`Carga aplicada: ${data.inserted} nuevos, ${data.updated} actualizados, ${data.unchanged} sin cambio${data.removed?` y ${data.removed} operaciones retiradas`:''}.`);else setPreview(data);}
  catch(e){setError(e instanceof Error?e.message:'Error al cargar.');}finally{setBusy(false);}}
 const unit=kind==='RUTAS'?'operaciones':'materiales';
 return <section className="panel"><h2>{title}</h2><p>{help}</p><p className="footnote">Columnas del Excel de SAP: {columns.join(' · ')}. Se reconocen por su nombre, en cualquier orden.</p>
  <div className="filters"><label>Archivo Excel (.xlsx)<input type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setError('');}}/></label>
   {kind==='INVENTARIO'&&<label>Fecha del corte de inventario<input type="date" value={snapshot} max={today()} onChange={e=>{setSnapshot(e.target.value);setPreview(null);}}/></label>}
   <button disabled={!file||busy} onClick={()=>submit(false)}>{busy&&!preview?'Validando…':'Validar archivo'}</button></div>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {preview&&<>
   <div className="metrics compact"><div><span>Filas válidas</span><strong>{preview.total}</strong><small>{preview.materials} materiales</small></div><div><span>Nuevos</span><strong>{preview.inserted}</strong><small>{unit}</small></div><div><span>Con cambios</span><strong>{preview.updated}</strong><small>{unit}</small></div><div><span>Sin cambio</span><strong>{preview.unchanged}</strong>{preview.removed>0&&<small>{preview.removed} operaciones se retiran</small>}</div></div>
   {preview.errors.slice(0,50).map((e:string,i:number)=><p className="alert error" key={i}>{e}</p>)}
   {preview.warnings.length>0&&<details><summary>{preview.warnings.length} avisos (no bloquean la carga)</summary>{preview.warnings.map((w:string,i:number)=><p className="footnote" key={i}>{w}</p>)}</details>}
   {preview.changed.length>0&&<details><summary>Materiales con cambios ({preview.changed.length})</summary><p className="footnote mono">{preview.changed.join(' · ')}</p></details>}
   <p><button className="primary" disabled={busy||preview.errors.length>0||(kind!=='INVENTARIO'&&preview.inserted+preview.updated+preview.removed===0)} onClick={()=>submit(true)}>{busy?'Aplicando…':'Confirmar carga'}</button>
    {kind==='INVENTARIO'&&<span className="muted"> Todos los materiales del archivo quedarán con fecha de actualización {day(snapshot)}.</span>}</p>
  </>}
 </section>;
}

const LABELS:Record<string,string>={price:'Costo',inventory_cost_pct:'% inventario',price_updated_at:'Últ. modificación SAP',free_stock:'Libre utilización',in_transit:'En tránsito',stock_date:'Fecha',standard_value:'Tiempo',standard_unit:'Unidad',base_quantity:'Cant. base',operation:'Operación',operation_text:'Texto',work_center:'Puesto',description:'Descripción',active:'Activo'};
/** Historial de cambios de un material (cada carga o edición queda registrada). */
export function HistoryButton({table,code,fields}:{table:string;code:string;fields:string[]}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<any[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!open||rows)return;fetch(`/api/masters?table=${table}&code=${encodeURIComponent(code)}`).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setRows(d);}).catch(e=>setError(e.message));},[open,rows,table,code]);
 return <>{<button className="compact-button" onClick={()=>setOpen(true)} aria-label={`Historial de ${code}`}><History size={14}/></button>}
  {open&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Historial de ${code}`}><div className="modal"><div className="section-heading"><div><p className="eyebrow">HISTORIAL</p><h2>{code}</h2></div><button className="icon-button" onClick={()=>setOpen(false)} aria-label="Cerrar"><X size={18}/></button></div>
   {error&&<p className="alert error">{error}</p>}{!rows&&!error&&<p className="muted">Cargando…</p>}
   {rows&&<div className="table-scroll short"><table><thead><tr><th>Fecha</th><th>Origen</th>{fields.map(f=><th key={f}>{LABELS[f]??f}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{when(r.changed_at)}</td><td>{r.deleted?'Eliminado':r.source==='CARGA_MASIVA'?'Carga masiva':'Manual'}</td>{fields.map(f=><td key={f}>{r.data[f]===null||r.data[f]===undefined?'—':String(r.data[f])}</td>)}</tr>)}</tbody></table></div>}
   {rows&&!rows.length&&<p className="muted">Sin cambios registrados.</p>}
  </div></div>}</>;
}

export function ImportLog({rows,snapshot}:{rows:any[];snapshot?:boolean}){
 if(!rows.length)return null;
 return <section className="panel"><h2>Últimas cargas masivas</h2><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Archivo</th>{snapshot&&<th>Fecha de corte</th>}<th className="number">Filas</th><th className="number">Nuevos</th><th className="number">Actualizados</th><th className="number">Sin cambio</th>{!snapshot&&<th className="number">Retirados</th>}</tr></thead>
  <tbody>{rows.map(i=><tr key={i.id}><td>{when(i.created_at)}</td><td>{i.file_name}</td>{snapshot&&<td>{day(i.snapshot_date)}</td>}<td className="number">{i.total_rows}</td><td className="number">{i.inserted_rows}</td><td className="number">{i.updated_rows}</td><td className="number">{i.unchanged_rows}</td>{!snapshot&&<td className="number">{i.removed_rows}</td>}</tr>)}</tbody></table></div></section>;
}
