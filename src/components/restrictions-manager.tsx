'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Clock, Gauge, Plus, Scale, Trash2, Users } from 'lucide-react';
import { buildCalendar, capacitySummary, matchesRestriction, netHours, WEEKDAY_LABELS, type Area, type AttendanceDay, type AttendanceMonth, type DemandItem, type PlanningCode, type Restriction, type WeekDay, type WorkDayException } from '@/lib/planning';
import type { PolicyRow } from '@/lib/mps-server';
import { LaborPolicyTab } from './labor-policy-tab';
import { ShiftsTab } from './shifts-tab';
import { DEFAULT_SHIFTS, type MpsShift } from '@/lib/mps';

type Props={month:string;tab:string;restrictions:Restriction[];items:DemandItem[];codes:PlanningCode[];areas:Area[];week:WeekDay[];exceptions:WorkDayException[];monthAttendance:AttendanceMonth[];dayAttendance:AttendanceDay[];referenceHours:number;canEdit:boolean;policies?:PolicyRow[];currentPolicy?:PolicyRow|null;policiesReady?:boolean;shifts?:MpsShift[];shiftsReady?:boolean};
const n0=new Intl.NumberFormat('es-EC',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('es-EC',{maximumFractionDigits:1});
const monthLabel=(m:string)=>new Date(m+'-15T12:00:00Z').toLocaleDateString('es-EC',{month:'long',year:'numeric',timeZone:'UTC'});
const shiftMonth=(m:string,d:number)=>{const [y,mo]=m.split('-').map(Number);const t=new Date(Date.UTC(y,mo-1+d,1));return t.toISOString().slice(0,7);};

function useSave(){
 const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function save(body:unknown,ok='Guardado.'){setBusy(true);setError('');setNotice('');try{const res=await fetch('/api/planning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error??'No se pudo guardar.');setNotice(ok);router.refresh();return true;}catch(e){setError(e instanceof Error?e.message:'Error');return false;}finally{setBusy(false);}}
 const messages=<>{error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert" role="status">{notice}</p>}</>;
 return {busy,save,messages};
}

export function RestrictionsManager(props:Props){
 const router=useRouter();const [tab,setTab]=useState(props.tab);
 const calendar=useMemo(()=>buildCalendar(props.month,props.week,props.exceptions,props.areas,props.monthAttendance,props.dayAttendance),[props]);
 const go=(month:string,t=tab)=>router.push(`/restrictions?month=${month}&tab=${t}`);
 const working=calendar.filter(d=>d.is_working&&d.hours>0);
 return <>
  <div className="month-bar"><button onClick={()=>go(shiftMonth(props.month,-1))} aria-label="Mes anterior">‹</button><input type="month" value={props.month} onChange={e=>e.target.value&&go(e.target.value)}/><button onClick={()=>go(shiftMonth(props.month,1))} aria-label="Mes siguiente">›</button>
   <span className="muted"><b>{monthLabel(props.month)}</b> · {working.length} días laborables · {n1.format(working.reduce((s,d)=>s+d.hours,0))} h disponibles · {n1.format(working.reduce((s,d)=>s+d.overtime,0))} h extra programadas</span></div>
  <div className="tabs" role="tablist">
   {[['capacity','Capacidad diaria',Gauge],['staff','Personal y asistencia',Users],['calendar','Jornada y calendario',CalendarDays],['shifts','Turnos',Clock],['policy','Políticas laborales',Scale]].map(([k,l,I]:any)=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>{setTab(k);window.history.replaceState(null,'',`/restrictions?month=${props.month}&tab=${k}`);}}><I size={15}/> {l}</button>)}
  </div>
  {tab==='capacity'&&<CapacityTab {...props} calendar={calendar}/>}
  {tab==='staff'&&<StaffTab {...props} calendar={calendar}/>}
  {tab==='calendar'&&<CalendarTab {...props} calendar={calendar}/>}
  {tab==='shifts'&&<ShiftsTab shifts={props.shifts??DEFAULT_SHIFTS} areas={props.areas} ready={props.shiftsReady??false} canEdit={props.canEdit} referenceHours={props.referenceHours}/>}
  {tab==='policy'&&<LaborPolicyTab policies={props.policies??[]} current={props.currentPolicy??null} ready={props.policiesReady??false} canEdit={props.canEdit} month={props.month}/>}
 </>;
}

type Cal=ReturnType<typeof buildCalendar>;
function CapacityTab({restrictions,items,codes,calendar,referenceHours,canEdit,week}:Props&{calendar:Cal}){
 const {busy,save,messages}=useSave();const [edit,setEdit]=useState<any>(null);
 const rows=capacitySummary(restrictions,items,calendar,referenceHours);
 const sat=week.find(w=>w.weekday===6);const satHours=sat?netHours({...sat,is_working:true}):0;
 const label=(kind:string,c:string)=>codes.find(x=>x.kind===kind&&x.code===c)?.name??c;
 const unconstrained=items.filter(i=>i.active&&i.monthly_demand>0&&!restrictions.some(r=>r.active&&matchesRestriction(i,r)));
 const blank={name:'',applies_to:'COLCHON',codes:'',sizes:'',max_per_day:'',active:true,notes:'',sort:restrictions.length+1};
 return <>
  <section className="panel">
   <div className="section-heading"><div><h2>Máximo por día</h2><p>Así trabaja hoy el planificador: un tope diario por grupo. Las letras que están en el mismo grupo comparten estaciones de trabajo y su suma no puede pasar el máximo.</p></div>{canEdit&&<button className="primary" onClick={()=>setEdit(blank)}><Plus size={16}/>Nueva restricción</button>}</div>
   <div className="restriction-grid">{restrictions.map(r=><article key={r.id} className={r.active?'':'inactive-row'}>
    <p className="eyebrow">{r.applies_to==='COLCHON'?'TIPO DE COLCHÓN':'TIPO DE PANEL'}</p><h3>{r.name}</h3>
    <p>{r.codes.map(c=><span key={c} className={`code-chip ${r.applies_to==='PANEL'?'panel':''}`} title={label(r.applies_to,c)}>{c}</span>)}{r.sizes&&<span className="muted"> medidas {r.sizes.join(' y ')}</span>}</p>
    <strong className="big-number">{n0.format(r.max_per_day)}</strong><small className="muted"> máximo por día</small>
    {r.notes&&<p className="footnote">{r.notes}</p>}
    {!r.active&&<span className="badge warning">Inactiva</span>}
    {canEdit&&<p><button className="compact-button" onClick={()=>setEdit({...r,codes:r.codes.join(', '),sizes:r.sizes?.join(', ')??''})}>Editar</button></p>}
   </article>)}</div>
   {edit&&<div className="edit-box"><h3>{edit.id?`Editar ${edit.name}`:'Nueva restricción'}</h3>
    <div className="bom-form-grid">
     <label>Nombre<input value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})} placeholder="Ej. COLCHÓN DE CAJA"/></label>
     <label>Aplica a<select value={edit.applies_to} onChange={e=>setEdit({...edit,applies_to:e.target.value})}><option value="COLCHON">Tipo de colchón</option><option value="PANEL">Tipo de panel</option></select></label>
     <label>Letras (separadas por coma)<input value={edit.codes} onChange={e=>setEdit({...edit,codes:e.target.value.toUpperCase()})} placeholder="X, N"/><small className="muted">Disponibles: {codes.filter(c=>c.kind===edit.applies_to).map(c=>`${c.code} (${c.name})`).join(' · ')}</small></label>
     <label>Solo estas medidas (opcional)<input value={edit.sizes} onChange={e=>setEdit({...edit,sizes:e.target.value})} placeholder="160, 200"/><small className="muted">Vacío = todas las medidas.</small></label>
     <label>Máximo por día<input type="number" min="0" value={edit.max_per_day} onChange={e=>setEdit({...edit,max_per_day:e.target.value})}/></label>
     <label className="inline-check"><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>Restricción activa</label>
     <label className="span-2">Notas<input value={edit.notes??''} onChange={e=>setEdit({...edit,notes:e.target.value})}/></label>
    </div>
    <div className="toolbar-row">{edit.id&&<button disabled={busy} onClick={async()=>{if(confirm(`¿Eliminar la restricción ${edit.name}?`)&&await save({action:'restriction-delete',id:edit.id},'Restricción eliminada.'))setEdit(null);}}><Trash2 size={15}/>Eliminar</button>}<span className="spacer"/><button onClick={()=>setEdit(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={async()=>{if(await save({action:'restriction',...edit},'Restricción guardada.'))setEdit(null);}}>Guardar</button></div>
   </div>}
   {messages}
  </section>
  <section className="panel">
   <h2>Demanda del mes contra capacidad</h2>
   <p>Capacidad efectiva = máximo por día × (horas del día ÷ {n1.format(referenceHours)} h de referencia) × asistencia de las áreas que limitan capacidad. Si la barra pasa la línea, con las restricciones actuales no se alcanza la demanda y se muestra lo que haría falta.</p>
   {!items.length&&<p className="alert">Todavía no hay demanda cargada. Carga la demanda en el módulo Demanda para ver este análisis.</p>}
   <div className="capacity-bars">{rows.map(r=>{const pct=r.effectiveMonth>0?r.demand/r.effectiveMonth:0;const over=r.gap>0;return <div key={r.restriction.id} className="capacity-row">
    <div><b>{r.restriction.name}</b><small className="muted">{r.restriction.codes.join(' + ')}{r.restriction.sizes?` · ${r.restriction.sizes.join('/')}`:''} · {r.models} modelos</small></div>
    <div className="bar-track" title={`Demanda ${n0.format(r.demand)} / capacidad ${n0.format(r.effectiveMonth)}`}><div className={`bar-fill ${over?'over':''}`} style={{width:`${Math.min(100,pct*100/1.5)}%`}}/><div className="bar-limit" style={{left:`${100/1.5}%`}}/></div>
    <div className="number"><b>{n0.format(r.demand)}</b> / {n0.format(r.effectiveMonth)}<br/><small className={over?'text-error':'muted'}>{r.demand?`${n0.format(pct*100)} % de la capacidad`:'sin demanda'}</small></div>
   </div>;})}</div>
   <div className="table-scroll"><table><thead><tr><th>Restricción</th><th className="number">Máx./día</th><th className="number">Días lab.</th><th className="number">Capacidad nominal</th><th className="number">Capacidad efectiva</th><th className="number">Demanda mes</th><th className="number">Días necesarios</th><th className="number">Faltante</th><th className="number">Horas extra necesarias</th><th className="number">≈ Sábados ({n1.format(satHours)} h)</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.restriction.id}><td>{r.restriction.name}</td><td className="number">{n0.format(r.restriction.max_per_day)}</td><td className="number">{r.workingDays}</td><td className="number">{n0.format(r.maxMonth)}</td><td className="number">{n0.format(r.effectiveMonth)}</td><td className="number"><b>{n0.format(r.demand)}</b></td><td className="number">{r.daysNeeded===null?'—':n1.format(r.daysNeeded)}</td>
     <td className="number">{r.gap>0?<span className="badge error">{n0.format(r.gap)}</span>:<span className="badge">Cubre</span>}</td><td className="number">{r.extraHours?n1.format(r.extraHours)+' h':'—'}</td><td className="number">{r.extraHours&&satHours?n1.format(r.extraHours/satHours):'—'}</td></tr>)}</tbody></table></div>
   {unconstrained.length>0&&<p className="footnote">{unconstrained.length} modelos con demanda ({n0.format(unconstrained.reduce((s,i)=>s+i.monthly_demand,0))} u/mes) no caen en ninguna restricción activa, por ejemplo tradicionales de medidas distintas a las restringidas; no tienen tope diario definido.</p>}
  </section></>;
}

function StaffTab({areas,month,monthAttendance,dayAttendance,calendar,canEdit}:Props&{calendar:Cal}){
 const {busy,save,messages}=useSave();
 const [edit,setEdit]=useState<any>(null);
 const [monthly,setMonthly]=useState<Record<number,string>>(()=>Object.fromEntries(areas.map(a=>[a.id,String(monthAttendance.find(m=>m.area_id===a.id)?.attendance_pct??'')])));
 const [day,setDay]=useState({day:`${month}-01`,note:'',values:{} as Record<number,string>});
 const loadDay=(d:string)=>setDay({day:d,note:dayAttendance.find(x=>x.day===d)?.note??'',values:Object.fromEntries(areas.map(a=>[a.id,String(dayAttendance.find(x=>x.day===d&&x.area_id===a.id)?.attendance_pct??'')]))});
 const active=areas.filter(a=>a.active);const overrideDays=[...new Set(dayAttendance.map(d=>d.day))];
 const present=(a:Area,pct:number)=>a.headcount===null?'—':n1.format(a.headcount*pct/100);
 return <>
  <section className="panel">
   <div className="section-heading"><div><h2>Áreas y personal</h2><p>Personal total por área y asistencia habitual. Las áreas marcadas como <b>limitan capacidad</b> (Tapicería y Cerrado) reducen la capacidad diaria cuando falta personal: se usa la asistencia más baja de esas áreas.</p></div>{canEdit&&<button className="primary" onClick={()=>setEdit({name:'',headcount:'',default_attendance_pct:100,limits_capacity:false,active:true,notes:'',sort:areas.length+1})}><Plus size={16}/>Nueva área</button>}</div>
   <div className="table-scroll"><table><thead><tr><th>Área</th><th className="number">Personal total</th><th className="number">Asistencia habitual</th><th className="number">Asistencia {monthLabel(month)}</th><th className="number">Personas presentes (mes)</th><th>Limita capacidad</th><th/></tr></thead>
    <tbody>{areas.map(a=>{const pct=Number(monthAttendance.find(m=>m.area_id===a.id)?.attendance_pct??a.default_attendance_pct);return <tr key={a.id} className={a.active?'':'inactive-row'}><td><b>{a.name}</b>{a.notes&&<><br/><small className="muted">{a.notes}</small></>}</td><td className="number">{a.headcount??<span className="badge warning">Por definir</span>}</td><td className="number">{n1.format(a.default_attendance_pct)} %</td><td className="number">{n1.format(pct)} %</td><td className="number">{present(a,pct)}</td><td>{a.limits_capacity?<span className="badge">Sí</span>:'No'}</td><td>{canEdit&&<button className="compact-button" onClick={()=>setEdit({...a,headcount:a.headcount??''})}>Editar</button>}</td></tr>;})}</tbody></table></div>
   {edit&&<div className="edit-box"><h3>{edit.id?`Editar ${edit.name}`:'Nueva área'}</h3><div className="bom-form-grid">
    <label>Nombre<input value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label>
    <label>Personal total<input type="number" min="0" step="1" value={edit.headcount} onChange={e=>setEdit({...edit,headcount:e.target.value})}/></label>
    <label>Asistencia habitual (%)<input type="number" min="0" max="100" step="0.5" value={edit.default_attendance_pct} onChange={e=>setEdit({...edit,default_attendance_pct:e.target.value})}/></label>
    <label className="inline-check"><input type="checkbox" checked={edit.limits_capacity} onChange={e=>setEdit({...edit,limits_capacity:e.target.checked})}/>Limita la capacidad diaria</label>
    <label className="inline-check"><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>Área activa</label>
    <label>Notas<input value={edit.notes??''} onChange={e=>setEdit({...edit,notes:e.target.value})}/></label></div>
    <div className="toolbar-row end"><button onClick={()=>setEdit(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={async()=>{if(await save({action:'area',...edit},'Área guardada.'))setEdit(null);}}>Guardar</button></div></div>}
  </section>
  <div className="two-columns">
   <section className="panel"><h2>Asistencia del mes</h2><p>Porcentaje de asistencia esperado para {monthLabel(month)}. Vacío = se usa la asistencia habitual del área.</p>
    {active.map(a=><label key={a.id} className="row-label">{a.name}<span><input type="number" min="0" max="100" step="0.5" disabled={!canEdit} value={monthly[a.id]??''} placeholder={String(a.default_attendance_pct)} onChange={e=>setMonthly({...monthly,[a.id]:e.target.value})}/> %</span></label>)}
    {canEdit&&<p><button className="primary" disabled={busy} onClick={()=>save({action:'attendance-month',month,values:active.map(a=>({area_id:a.id,attendance_pct:monthly[a.id]??''}))},'Asistencia del mes guardada.')}>Guardar asistencia del mes</button></p>}
   </section>
   <section className="panel"><h2>Asistencia de un día específico</h2><p>Úsalo cuando ya sabes que un día faltará personal (permisos, vacaciones, enfermedad). Tiene prioridad sobre el porcentaje del mes.</p>
    <label>Fecha<input type="date" value={day.day} min={`${month}-01`} max={calendar[calendar.length-1].day} onChange={e=>e.target.value&&loadDay(e.target.value)}/></label>
    {active.map(a=><label key={a.id} className="row-label">{a.name}<span><input type="number" min="0" max="100" step="0.5" disabled={!canEdit} value={day.values[a.id]??''} placeholder="mes" onChange={e=>setDay({...day,values:{...day.values,[a.id]:e.target.value}})}/> %</span></label>)}
    <label>Motivo<input value={day.note} disabled={!canEdit} onChange={e=>setDay({...day,note:e.target.value})}/></label>
    {canEdit&&<p><button className="primary" disabled={busy} onClick={()=>save({action:'attendance-day',day:day.day,note:day.note,values:active.map(a=>({area_id:a.id,attendance_pct:day.values[a.id]??''}))},'Asistencia del día guardada.')}>Guardar día</button></p>}
    {overrideDays.length>0&&<><h3>Días con asistencia específica</h3>{overrideDays.map(d=><p key={d} className="footnote"><button className="link-button" onClick={()=>loadDay(d)}>{d}</button> · {dayAttendance.filter(x=>x.day===d).map(x=>`${areas.find(a=>a.id===x.area_id)?.name} ${n1.format(x.attendance_pct)} %`).join(' · ')}{dayAttendance.find(x=>x.day===d)?.note?` · ${dayAttendance.find(x=>x.day===d)?.note}`:''}</p>)}</>}
   </section>
  </div>
  {messages}
 </>;
}

function CalendarTab({week,exceptions,month,calendar,referenceHours,areas,canEdit}:Props&{calendar:Cal}){
 const {busy,save,messages}=useSave();
 const [rows,setRows]=useState(week.map(w=>({...w})));
 const [ex,setEx]=useState<any>(null);const [ref,setRef]=useState(String(referenceHours));
 const lead=(calendar[0].weekday+6)%7;
 const limiting=areas.filter(a=>a.active&&a.limits_capacity);
 return <>
  <section className="panel">
   <h2>Semana tipo</h2><p>Horario habitual por día. Las horas por encima de las <b>ordinarias</b> se cuentan como horas extra. El sábado viene desactivado: actívalo aquí si se trabaja todos los sábados, o agrégalo como excepción solo en las fechas que se trabaje.</p>
   <div className="table-scroll"><table><thead><tr><th>Día</th><th>Se trabaja</th><th>Entrada</th><th>Salida</th><th>Almuerzo / descanso (min)</th><th>Horas ordinarias</th><th className="number">Horas netas</th><th className="number">Horas extra</th><th/></tr></thead>
    <tbody>{rows.map((w,i)=>{const h=netHours(w);const set=(p:Partial<WeekDay>)=>setRows(rows.map((r,j)=>j===i?{...r,...p}:r));return <tr key={w.weekday} className={w.is_working?'':'inactive-row'}>
     <td><b>{WEEKDAY_LABELS[w.weekday-1]}</b></td><td><input type="checkbox" disabled={!canEdit} checked={w.is_working} onChange={e=>set({is_working:e.target.checked})} aria-label={`Se trabaja el ${WEEKDAY_LABELS[w.weekday-1]}`}/></td>
     <td><input type="time" disabled={!canEdit} value={w.start_time} onChange={e=>set({start_time:e.target.value})}/></td><td><input type="time" disabled={!canEdit} value={w.end_time} onChange={e=>set({end_time:e.target.value})}/></td>
     <td><input className="narrow" type="number" min="0" disabled={!canEdit} value={w.break_minutes} onChange={e=>set({break_minutes:Number(e.target.value)})}/></td><td><input className="narrow" type="number" min="0" max="24" step="0.5" disabled={!canEdit} value={w.ordinary_hours} onChange={e=>set({ordinary_hours:Number(e.target.value)})}/></td>
     <td className="number">{n1.format(h)}</td><td className="number">{n1.format(Math.max(0,h-(w.is_working?Math.min(h,w.ordinary_hours):h)))}</td>
     <td>{canEdit&&JSON.stringify(w)!==JSON.stringify(week[i])&&<button className="compact-button primary" disabled={busy} onClick={()=>save({action:'week',...w},`${WEEKDAY_LABELS[w.weekday-1]} guardado.`)}>Guardar</button>}</td></tr>;})}</tbody></table></div>
   <div className="filters"><label>Horas de referencia del “máximo por día”<input type="number" min="1" max="24" step="0.5" disabled={!canEdit} value={ref} onChange={e=>setRef(e.target.value)}/><small className="muted">Horas netas de la jornada en la que se fijaron los máximos diarios (07:00-19:00 con 1 h de almuerzo = 11 h). Un día más corto tiene capacidad proporcional.</small></label>{canEdit&&<button disabled={busy||ref===String(referenceHours)} onClick={()=>save({action:'reference-hours',value:ref},'Horas de referencia guardadas.')}>Guardar</button>}</div>
  </section>
  <section className="panel">
   <div className="section-heading"><div><h2>Calendario de {monthLabel(month)}</h2><p>Haz clic en un día para cambiar su jornada: sábado trabajado, feriado o salida temprana. El porcentaje es la asistencia que limita la capacidad ese día{limiting.length?` (${limiting.map(a=>a.name).join(', ')})`:''}.</p></div></div>
   <div className="calendar-grid">{WEEKDAY_LABELS.map(d=><b key={d}>{d.slice(0,3)}</b>)}{Array.from({length:lead},(_,i)=><span key={'e'+i}/>)}
    {calendar.map(d=><button key={d.day} className={`calendar-day ${d.is_working?'':'off'} ${d.exception?'exception':''}`} disabled={!canEdit} onClick={()=>{const e=exceptions.find(x=>x.day===d.day);const base=e??week.find(w=>w.weekday===d.weekday)!;setEx({day:d.day,is_working:e?e.is_working:true,start_time:base.start_time,end_time:base.end_time,break_minutes:base.break_minutes,ordinary_hours:base.ordinary_hours,note:e?.note??'',exists:!!e});}}>
     <span className="day-number">{Number(d.day.slice(8))}</span>{d.is_working?<><span>{n1.format(d.hours)} h</span>{d.overtime>0&&<small>+{n1.format(d.overtime)} extra</small>}<small className={d.factor<1?'text-error':''}>{n0.format(d.factor*100)} % asist.</small></>:<small>No laborable</small>}{d.note&&<small className="day-note">{d.note}</small>}
    </button>)}</div>
   {ex&&<div className="edit-box"><h3>Jornada del {ex.day}</h3><div className="bom-form-grid">
    <label className="inline-check"><input type="checkbox" checked={ex.is_working} onChange={e=>setEx({...ex,is_working:e.target.checked})}/>Se trabaja este día</label>
    <label>Motivo<input value={ex.note} onChange={e=>setEx({...ex,note:e.target.value})} placeholder="Ej. Sábado para cumplir demanda / Feriado"/></label>
    <label>Entrada<input type="time" value={ex.start_time} onChange={e=>setEx({...ex,start_time:e.target.value})}/></label><label>Salida<input type="time" value={ex.end_time} onChange={e=>setEx({...ex,end_time:e.target.value})}/></label>
    <label>Almuerzo / descanso (min)<input type="number" min="0" value={ex.break_minutes} onChange={e=>setEx({...ex,break_minutes:Number(e.target.value)})}/></label><label>Horas ordinarias<input type="number" min="0" max="24" step="0.5" value={ex.ordinary_hours} onChange={e=>setEx({...ex,ordinary_hours:Number(e.target.value)})}/><small className="muted">En un sábado extra normalmente 0: todas las horas cuentan como extra.</small></label></div>
    <div className="toolbar-row">{ex.exists&&<button disabled={busy} onClick={async()=>{if(await save({action:'workday-delete',day:ex.day},'Se restauró la jornada de la semana tipo.'))setEx(null);}}>Quitar excepción</button>}<span className="spacer"/><button onClick={()=>setEx(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={async()=>{if(await save({action:'workday',...ex},'Jornada del día guardada.'))setEx(null);}}>Guardar día</button></div></div>}
  </section>
  {messages}
 </>;
}
