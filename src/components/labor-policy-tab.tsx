'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { PolicyRow } from '@/lib/mps-server';
import { DEFAULT_POLICY } from '@/lib/mps';

const usd=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',minimumFractionDigits:2});
const n1=new Intl.NumberFormat('es-EC',{maximumFractionDigits:1});

/** Políticas laborales con fecha de vigencia: sueldo básico, recargos, topes de horas extra y sábados. Alimentan el costo del plan maestro. */
export function LaborPolicyTab({policies,current,ready,canEdit,month}:{policies:PolicyRow[];current:PolicyRow|null;ready:boolean;canEdit:boolean;month:string}){
 const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const base:PolicyRow=current??policies[0]??{...DEFAULT_POLICY,valid_from:'valor por defecto'};
 const blank=(p?:PolicyRow)=>({valid_from:p?.valid_from??`${month}-01`,baseSalary:p?.baseSalary??482,monthlyHours:p?.monthlyHours??240,overtimeSurchargePct:p?.overtimeSurchargePct??50,extraordinarySurchargePct:p?.extraordinarySurchargePct??100,maxOvertimeDay:p?.maxOvertimeDay??4,maxOvertimeWeek:p?.maxOvertimeWeek??12,saturdayEnabled:p?.saturdayEnabled??true,saturdayMaxHours:p?.saturdayMaxHours??8,notes:p?.notes??''});
 const [edit,setEdit]=useState<ReturnType<typeof blank>|null>(null);
 async function save(){if(!edit)return;setBusy(true);setError('');setNotice('');
  try{const res=await fetch('/api/mps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'policy',...edit})});const data=await res.json();if(!res.ok)throw new Error(data.error??'No se pudo guardar.');setNotice('Política guardada.');setEdit(null);router.refresh();}
  catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}}
 const hour=(p:{baseSalary:number;monthlyHours:number})=>p.baseSalary/p.monthlyHours;
 const field=(label:string,k:keyof ReturnType<typeof blank>,step='1')=><label>{label}<input type="number" step={step} value={String(edit![k])} onChange={e=>setEdit({...edit!,[k]:Number(e.target.value)})}/></label>;
 return <>
  {!ready&&<p className="alert">Vista previa: la tabla de políticas laborales todavía no está creada en Supabase. Se muestran los valores de Ecuador por defecto; para guardar cambios hay que crearla.</p>}
  <section className="panel">
   <div className="section-heading"><div><h2>Política laboral vigente</h2><p>El plan maestro usa esta política para calcular cuánto cuesta cada hora extra y hasta dónde se puede llegar. Cuando cambie la ley o el sueldo básico, agrega una nueva política con la fecha desde la que rige: las anteriores quedan como historial y los meses pasados se siguen calculando con la suya.</p></div>
    {canEdit&&ready&&<button className="primary" onClick={()=>setEdit(blank(base))}><Plus size={16}/>Nueva política</button>}</div>
   {error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert" role="status">{notice}</p>}
   {base&&<div className="metrics compact">
    <div><span>Sueldo básico</span><strong>{usd.format(base.baseSalary)}</strong><small>rige desde {base.valid_from}</small></div>
    <div><span>Valor hora ordinaria</span><strong>{usd.format(hour(base))}</strong><small>sueldo ÷ {n1.format(base.monthlyHours)} h</small></div>
    <div><span>Hora suplementaria (lun–vie)</span><strong>{usd.format(hour(base)*(1+base.overtimeSurchargePct/100))}</strong><small>+{n1.format(base.overtimeSurchargePct)} % · máx. {n1.format(base.maxOvertimeDay)} h/día y {n1.format(base.maxOvertimeWeek)} h/semana</small></div>
    <div><span>Hora de sábado</span><strong>{base.saturdayEnabled?usd.format(hour(base)*(1+base.extraordinarySurchargePct/100)):'No se trabaja'}</strong><small>{base.saturdayEnabled?`+${n1.format(base.extraordinarySurchargePct)} % · hasta ${n1.format(base.saturdayMaxHours)} h`:'sábados deshabilitados'}</small></div>
   </div>}
   {edit&&<div className="edit-box"><h3>Nueva política laboral</h3>
    <div className="bom-form-grid">
     <label>Rige desde<input type="date" value={edit.valid_from} onChange={e=>setEdit({...edit,valid_from:e.target.value})}/></label>
     {field('Sueldo básico (USD)','baseSalary','0.01')}
     {field('Horas ordinarias del mes','monthlyHours')}
     {field('Recargo suplementarias lun–vie (%)','overtimeSurchargePct')}
     {field('Recargo sábados y feriados (%)','extraordinarySurchargePct')}
     {field('Máximo de horas extra por día','maxOvertimeDay','0.5')}
     {field('Máximo de horas extra por semana','maxOvertimeWeek','0.5')}
     <label className="inline-check"><input type="checkbox" checked={edit.saturdayEnabled} onChange={e=>setEdit({...edit,saturdayEnabled:e.target.checked})}/> Se permite trabajar sábados</label>
     {edit.saturdayEnabled&&field('Horas máximas el sábado','saturdayMaxHours','0.5')}
     <label className="span-2">Nota<input value={edit.notes??''} onChange={e=>setEdit({...edit,notes:e.target.value})} placeholder="Ej. Acuerdo ministerial del sueldo básico 2027"/></label>
    </div>
    <p className="footnote">Valor hora = sueldo ÷ horas del mes. Hora suplementaria = valor hora × (1 + recargo). Si guardas con una fecha que ya existe, se reemplaza esa política.</p>
    <div className="toolbar-row end"><button onClick={()=>setEdit(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar política'}</button></div></div>}
  </section>
  {policies.length>0&&<section className="panel"><h2>Historial</h2>
   <div className="table-scroll short"><table><thead><tr><th>Rige desde</th><th className="number">Sueldo básico</th><th className="number">Valor hora</th><th className="number">Suplementarias</th><th className="number">Tope día / semana</th><th>Sábados</th><th>Nota</th></tr></thead>
    <tbody>{policies.map(p=><tr key={p.valid_from}><td>{p.valid_from}</td><td className="number">{usd.format(p.baseSalary)}</td><td className="number">{usd.format(hour(p))}</td><td className="number">+{n1.format(p.overtimeSurchargePct)} %</td><td className="number">{n1.format(p.maxOvertimeDay)} h / {n1.format(p.maxOvertimeWeek)} h</td><td>{p.saturdayEnabled?`Sí, ${n1.format(p.saturdayMaxHours)} h, +${n1.format(p.extraordinarySurchargePct)} %`:'No'}</td><td>{p.notes}</td></tr>)}</tbody></table></div></section>}
 </>;
}
