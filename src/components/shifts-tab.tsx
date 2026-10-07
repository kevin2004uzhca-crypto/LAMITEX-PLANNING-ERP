'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { MpsShift } from '@/lib/mps';
import type { Area } from '@/lib/planning';

const n1=new Intl.NumberFormat('es-EC',{maximumFractionDigits:1});
const numOrNull=(v:string)=>v.trim()===''?null:Number(v);

/**
 * Turnos de trabajo (día y noche). Cada área trabaja en todos los turnos activos; el turno de noche rinde menos
 * y lleva recargo nocturno. Alimentan la capacidad, el costo de horas extra y el aprendizaje del plan maestro.
 */
export function ShiftsTab({shifts,areas,ready,canEdit,referenceHours}:{shifts:MpsShift[];areas:Area[];ready:boolean;canEdit:boolean;referenceHours:number}){
 const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [rows,setRows]=useState<MpsShift[]>(shifts);
 const active=areas.filter(a=>a.active);
 const set=(i:number,patch:Partial<MpsShift>)=>setRows(rows.map((r,j)=>j===i?{...r,...patch}:r));
 const setHead=(i:number,key:string,v:string)=>set(i,{headcount:{...rows[i].headcount,[key]:numOrNull(v)}});
 const add=()=>setRows([...rows,{key:`T${Date.now().toString(36)}`,name:`Turno ${rows.length+1}`,productivityPct:100,ordinaryHours:null,referenceHours:null,nightSurchargePct:0,saturday:false,active:true,headcount:{}}]);
 const dirty=JSON.stringify(rows)!==JSON.stringify(shifts);
 async function save(){setBusy(true);setError('');setNotice('');
  try{const res=await fetch('/api/mps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'settings',key:'shifts',value:rows})});const data=await res.json();if(!res.ok)throw new Error(data.error??'No se pudo guardar.');setNotice('Turnos guardados. El plan maestro y el aprendizaje ya los usan.');router.refresh();}
  catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}
 const people=(s:MpsShift,a:Area)=>s.headcount?.[`A${a.id}`]??a.headcount??0;
 const edit=canEdit&&ready;
 return <>
  {!ready&&<p className="alert">Vista previa: la tabla de parámetros del plan maestro todavía no está creada en Supabase. Se muestran los turnos por defecto (día 100 % y noche 85 %); para guardar cambios hay que crearla.</p>}
  <section className="panel">
   <div className="section-heading"><div><h2>Turnos de trabajo</h2><p>La planta trabaja en turno de día y turno de noche. El de noche produce menos por hora (85 % del día por defecto) y su hora extra lleva el recargo nocturno. El plan maestro suma la capacidad de todos los turnos activos y reparte las horas extra donde salen más baratas.</p></div>
    {edit&&rows.length<4&&<button onClick={add}><Plus size={16}/>Agregar turno</button>}</div>
   {error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert" role="status">{notice}</p>}
   <div className="table-scroll"><table><thead><tr><th>Turno</th><th>Activo</th><th className="number">Productividad (%)</th><th className="number">Horas ordinarias</th><th className="number">Horas de referencia</th><th className="number">Recargo nocturno (%)</th><th>Trabaja sábado</th>{edit&&<th/>}</tr></thead>
    <tbody>{rows.map((s,i)=><tr key={s.key}>
     <td>{edit?<input value={s.name} onChange={e=>set(i,{name:e.target.value})}/>:s.name}</td>
     <td><input type="checkbox" disabled={!edit} checked={s.active} onChange={e=>set(i,{active:e.target.checked})}/></td>
     <td className="number">{edit?<input type="number" min="1" max="150" value={s.productivityPct} onChange={e=>set(i,{productivityPct:Number(e.target.value)})}/>:n1.format(s.productivityPct)}</td>
     <td className="number">{edit?<input type="number" min="0" max="12" step="0.5" placeholder="calendario" value={s.ordinaryHours??''} onChange={e=>set(i,{ordinaryHours:numOrNull(e.target.value)})}/>:s.ordinaryHours??'calendario'}</td>
     <td className="number">{edit?<input type="number" min="1" max="24" step="0.5" placeholder={String(referenceHours)} value={s.referenceHours??''} onChange={e=>set(i,{referenceHours:numOrNull(e.target.value)})}/>:s.referenceHours??referenceHours}</td>
     <td className="number">{edit?<input type="number" min="0" max="200" value={s.nightSurchargePct} onChange={e=>set(i,{nightSurchargePct:Number(e.target.value)})}/>:n1.format(s.nightSurchargePct)}</td>
     <td><input type="checkbox" disabled={!edit} checked={s.saturday} onChange={e=>set(i,{saturday:e.target.checked})}/></td>
     {edit&&<td>{rows.length>1&&<button className="icon-button" aria-label={`Quitar ${s.name}`} onClick={()=>setRows(rows.filter((_,j)=>j!==i))}><Trash2 size={15}/></button>}</td>}
    </tr>)}</tbody></table></div>
   <p className="footnote">Horas ordinarias vacías = las del calendario (Jornada y calendario). Horas de referencia vacías = {n1.format(referenceHours)} h, la jornada en la que se fijaron los máximos por día; el máximo por día de cada grupo vale para el día completo con todos los turnos. Recargo nocturno de Ecuador: 25 % sobre el valor hora entre las 19:00 y las 06:00.</p>
  </section>
  <section className="panel">
   <div className="section-heading"><div><h2>Personal por turno</h2><p>Personas de cada área en cada turno. Vacío = el personal base del área (pestaña Personal y asistencia). El ausentismo del área se aplica a todos sus turnos.</p></div></div>
   <div className="table-scroll short"><table><thead><tr><th>Área</th><th className="number">Personal base</th>{rows.map(s=><th key={s.key} className="number">{s.name}</th>)}<th className="number">Total</th></tr></thead>
    <tbody>{active.map(a=><tr key={a.id}><td>{a.name}</td><td className="number">{a.headcount??'—'}</td>
     {rows.map((s,i)=><td key={s.key} className="number">{edit?<input type="number" min="0" max="500" placeholder={String(a.headcount??0)} value={s.headcount?.[`A${a.id}`]??''} onChange={e=>setHead(i,`A${a.id}`,e.target.value)}/>:n1.format(people(s,a))}</td>)}
     <td className="number">{n1.format(rows.filter(s=>s.active).reduce((t,s)=>t+people(s,a),0))}</td></tr>)}</tbody></table></div>
   {edit&&<div className="toolbar-row end"><button disabled={!dirty||busy} onClick={()=>setRows(shifts)}>Deshacer</button><button className="primary" disabled={!dirty||busy} onClick={save}>{busy?'Guardando…':'Guardar turnos'}</button></div>}
  </section>
 </>;
}
