'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Upload } from 'lucide-react';
import { checkProgram, WEEKDAYS, WEEKDAY_LABELS, type DemandItem, type PlanningCode, type Restriction } from '@/lib/planning';

export type Program={id:number;name:string;weekday:string;program_date:string|null;source_file:string|null;sheet_name:string|null;notes:string|null;created_at:string;lines:{material_code:string;description:string|null;quantity:number;source_row:number|null}[]};
type Props={programs:Program[];items:DemandItem[];restrictions:Restriction[];codes:PlanningCode[];canEdit:boolean};
const n0=new Intl.NumberFormat('es-EC',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('es-EC',{maximumFractionDigits:1});
const dayLabel=(w:string)=>WEEKDAY_LABELS[WEEKDAYS.indexOf(w as any)]??w;

export function TrainingManager({programs,items,restrictions,codes,canEdit}:Props){
 const router=useRouter();const [upload,setUpload]=useState(!programs.length);const [selected,setSelected]=useState<number|null>(programs[0]?.id??null);
 const analysis=useMemo(()=>programs.map(p=>({p,...checkProgram(p.lines,items,restrictions)})),[programs,items,restrictions]);
 const active=restrictions.filter(r=>r.active);
 const current=analysis.find(a=>a.p.id===selected)??analysis[0];
 const map=new Map(items.map(i=>[i.material_code,i]));
 // Patrones de la programación real: cuánto se programa por día en cada grupo y qué modelos se repiten.
 const avg=active.map(r=>{const v=analysis.map(a=>a.checks.find(c=>c.restriction.id===r.id)?.planned??0);return {r,avg:v.length?v.reduce((s,x)=>s+x,0)/v.length:0,max:v.length?Math.max(...v):0,over:v.filter(x=>x>Number(r.max_per_day)).length};});
 const freq=new Map<string,{code:string;description:string;days:number;total:number}>();
 for(const a of analysis)for(const l of a.p.lines){const f=freq.get(l.material_code)??{code:l.material_code,description:l.description??'',days:0,total:0};f.days++;f.total+=l.quantity;freq.set(l.material_code,f);}
 const top=[...freq.values()].sort((a,b)=>b.days-a.days||b.total-a.total).slice(0,15);

 return <>
  <div className="toolbar-row">{canEdit&&<button className={upload?'selected-tool':''} onClick={()=>setUpload(!upload)}><Upload size={16}/>Subir Excel de programas</button>}</div>
  {upload&&canEdit&&<TrainingUpload onDone={()=>{setUpload(false);router.refresh();}}/>}
  {!programs.length?<div className="empty-state"><p>Aún no hay programas de entrenamiento. Sube el Excel PROGRAMAS ENTRENAMIENTO LAMITEX: cada hoja se guarda como un programa diario.</p></div>:<>
  <section className="panel">
   <h2>Programas contra el máximo por día</h2>
   <p>Cada celda muestra lo programado en el grupo y su máximo diario. En rojo, los días en que el programa pasa la restricción: ahí es donde hoy se fuerza al personal.</p>
   <div className="table-scroll"><table><thead><tr><th>Programa</th><th>Día</th><th className="number">Total unidades</th>{active.map(r=><th key={r.id} className="number">{r.name}<br/><small>máx. {n0.format(r.max_per_day)}</small></th>)}<th/></tr></thead>
    <tbody>{analysis.map(a=><tr key={a.p.id} className={a.p.id===current?.p.id?'selected-row':''}><td><button className="link-button" onClick={()=>setSelected(a.p.id)}>{a.p.name}</button>{a.p.program_date&&<><br/><small className="muted">{a.p.program_date}</small></>}</td><td>{dayLabel(a.p.weekday)}</td><td className="number"><b>{n0.format(a.total)}</b></td>
     {a.checks.map(c=><td key={c.restriction.id} className="number"><span className={c.excess>0?'badge error':c.planned?'badge':''}>{n0.format(c.planned)}</span>{c.excess>0&&<><br/><small className="text-error">+{n0.format(c.excess)} ({n0.format(c.usage*100)} %)</small></>}</td>)}
     <td>{a.unknown.length>0&&<span className="badge warning" title="Materiales que no están en la demanda: no se sabe su tipo">{a.unknown.length} sin tipo</span>}</td></tr>)}</tbody>
    <tfoot><tr><td colSpan={3}>Promedio por día programado</td>{avg.map(x=><td key={x.r.id} className="number">{n0.format(x.avg)}<br/><small className="muted">máx. {n0.format(x.max)} · {x.over}/{analysis.length} días excedidos</small></td>)}<td/></tr></tfoot></table></div>
   <p className="footnote">Los programas cargados suman en promedio {n0.format(analysis.reduce((s,a)=>s+a.total,0)/analysis.length)} colchones por día.{!items.length&&' Carga la demanda para conocer el tipo de cada modelo y compararlo con las restricciones.'}</p>
  </section>
  {current&&<ProgramDetail key={current.p.id} a={current} map={map} codes={codes} canEdit={canEdit} onChanged={()=>router.refresh()}/>}
  <section className="panel"><h2>Modelos que más se programan</h2><p>Frecuencia de cada modelo en los programas cargados. Es la señal de qué modelos el planificador prioriza en un día típico.</p>
   <div className="table-scroll"><table><thead><tr><th>Material</th><th>Descripción</th><th>Tipo</th><th className="number">Días programado</th><th className="number">Cantidad promedio por día</th><th className="number">Demanda mensual</th></tr></thead>
    <tbody>{top.map(f=>{const it=map.get(f.code);return <tr key={f.code}><td className="mono">{f.code}</td><td>{f.description}</td><td>{it?<><span className="code-chip">{it.mattress_type}</span> <span className="code-chip panel">{it.panel_type}</span></>:<span className="badge warning">Sin demanda</span>}</td><td className="number">{f.days} / {analysis.length}</td><td className="number">{n1.format(f.total/f.days)}</td><td className="number">{it?n0.format(it.monthly_demand):'—'}</td></tr>;})}</tbody></table></div></section>
  </>}
 </>;
}

function ProgramDetail({a,map,codes,canEdit,onChanged}:{a:ReturnType<typeof checkProgram>&{p:Program};map:Map<string,DemandItem>;codes:PlanningCode[];canEdit:boolean;onChanged:()=>void}){
 const [form,setForm]=useState({name:a.p.name,weekday:a.p.weekday,program_date:a.p.program_date??'',notes:a.p.notes??''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function send(body:unknown){setBusy(true);setError('');try{const res=await fetch('/api/training',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await res.json();if(!res.ok)throw new Error(d.error);onChanged();}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}
 const name=(kind:string,c:string)=>codes.find(x=>x.kind===kind&&x.code===c)?.name??c;
 return <section className="panel">
  <div className="section-heading"><div><p className="eyebrow">PROGRAMA</p><h2>{a.p.name}</h2><p>{dayLabel(a.p.weekday)} · {a.p.lines.length} modelos · {n0.format(a.total)} unidades{a.p.source_file?` · ${a.p.source_file} / ${a.p.sheet_name}`:''}</p></div>
   <p className="type-split">{Object.entries(a.byType).map(([t,q])=><span key={t} title={name('COLCHON',t)}><b className="code-chip">{t}</b>{n0.format(q)}</span>)}</p></div>
  {canEdit&&<div className="filters"><label>Nombre<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Día<select value={form.weekday} onChange={e=>setForm({...form,weekday:e.target.value})}>{WEEKDAYS.map((w,i)=><option key={w} value={w}>{WEEKDAY_LABELS[i]}</option>)}</select></label><label>Fecha (opcional)<input type="date" value={form.program_date} onChange={e=>setForm({...form,program_date:e.target.value})}/></label><label>Notas<input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
   <button disabled={busy} onClick={()=>send({action:'update',id:a.p.id,...form})}>Guardar</button><button disabled={busy} onClick={()=>confirm(`¿Eliminar el programa ${a.p.name}? Solo se borra este programa de entrenamiento.`)&&send({action:'delete',id:a.p.id})} aria-label="Eliminar programa"><Trash2 size={15}/></button></div>}
  {error&&<p className="alert error">{error}</p>}
  <div className="table-scroll"><table><thead><tr><th>Material</th><th>Descripción del material</th><th>Tipo colchón</th><th>Tipo panel</th><th className="number">Medida</th><th className="number">Cantidad programada</th><th className="number">Demanda mensual</th></tr></thead>
   <tbody>{a.p.lines.map((l,i)=>{const it=map.get(l.material_code);return <tr key={i}><td className="mono">{l.material_code}</td><td>{l.description}</td><td>{it?<span className="code-chip">{it.mattress_type}</span>:<span className="badge warning">Sin demanda</span>}</td><td>{it&&<span className="code-chip panel">{it.panel_type}</span>}</td><td className="number">{it?.size_cm??'—'}</td><td className="number"><b>{n0.format(l.quantity)}</b></td><td className="number">{it?n0.format(it.monthly_demand):'—'}</td></tr>;})}</tbody></table></div>
  {a.unknown.length>0&&<p className="alert">{a.unknown.length} materiales de este programa no están en la demanda, por eso no se sabe su tipo de colchón o panel y no cuentan contra las restricciones: {a.unknown.map(u=>u.material_code).join(', ')}.</p>}
 </section>;
}

function TrainingUpload({onDone}:{onDone:()=>void}){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<any>(null),[choices,setChoices]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(confirm:boolean){if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.set('file',file);if(confirm){form.set('confirm','yes');form.set('hash',preview.hash);form.set('choices',JSON.stringify(choices));}
  const res=await fetch('/api/training/import',{method:'POST',body:form});const data=await res.json();if(!res.ok)throw new Error(data.error);
  if(confirm)onDone();else{setPreview(data);setChoices(data.programs.map((p:any)=>({sheet:p.sheet,include:!p.errors.length,name:p.name,weekday:p.weekday??'',program_date:''})));}}
  catch(e){setError(e instanceof Error?e.message:'Error al cargar.');}finally{setBusy(false);}}
 const set=(i:number,p:any)=>setChoices(choices.map((c,j)=>j===i?{...c,...p}:c));
 return <section className="panel"><h2>Subir programas de entrenamiento</h2>
  <p>Cada hoja del Excel es un programa diario con las columnas <b>Material · Descripción del material · cantidad</b> (tercera columna). El día se reconoce por el nombre de la hoja (LUNES, MIERCOLES, …) y puedes corregirlo antes de guardar.</p>
  <label>Archivo Excel (.xlsx)<input type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setError('');}}/></label>
  <p><button disabled={!file||busy} onClick={()=>submit(false)}>{busy&&!preview?'Leyendo…':'Leer archivo'}</button></p>
  {error&&<p role="alert" className="alert error">{error}</p>}
  {preview&&<>
   {preview.alreadyLoaded.length>0&&<p className="alert">Este mismo archivo ya se cargó antes ({preview.alreadyLoaded.map((p:any)=>p.name).join(', ')}). Si lo vuelves a guardar se crearán programas duplicados.</p>}
   <div className="table-scroll"><table><thead><tr><th>Guardar</th><th>Hoja</th><th>Nombre del programa</th><th>Día</th><th>Fecha (opcional)</th><th className="number">Modelos</th><th className="number">Unidades</th><th>Revisión</th></tr></thead>
    <tbody>{preview.programs.map((p:any,i:number)=><tr key={p.sheet}><td><input type="checkbox" checked={choices[i]?.include} disabled={p.errors.length>0} onChange={e=>set(i,{include:e.target.checked})} aria-label={`Guardar ${p.sheet}`}/></td><td>{p.sheet}</td>
     <td><input value={choices[i]?.name??''} onChange={e=>set(i,{name:e.target.value})}/></td>
     <td><select value={choices[i]?.weekday??''} onChange={e=>set(i,{weekday:e.target.value})}><option value="">Elegir…</option>{WEEKDAYS.map((w,k)=><option key={w} value={w}>{WEEKDAY_LABELS[k]}</option>)}</select></td>
     <td><input type="date" value={choices[i]?.program_date??''} onChange={e=>set(i,{program_date:e.target.value})}/></td>
     <td className="number">{p.lines.length}</td><td className="number">{n0.format(p.total)}</td>
     <td>{p.errors.map((e:string,k:number)=><p key={k} className="text-error footnote">{e}</p>)}{p.warnings.map((w:string,k:number)=><p key={k} className="footnote">{w}</p>)}{!p.errors.length&&!p.warnings.length&&<span className="badge">OK</span>}</td></tr>)}</tbody></table></div>
   <p><button className="primary" disabled={busy||!choices.some(c=>c.include)||choices.some(c=>c.include&&!c.weekday)} onClick={()=>submit(true)}>{busy?'Guardando…':`Guardar ${choices.filter(c=>c.include).length} programas`}</button></p>
  </>}
 </section>;
}
