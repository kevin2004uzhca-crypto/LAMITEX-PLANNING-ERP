'use client';
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrainCircuit, CalendarRange, Dices, LineChart, PackageSearch, Play, Save, SlidersHorizontal } from 'lucide-react';
import { CLASS_LABEL, type Classification, type LaborPolicy, type MonteCarloSummary, type MpsArea, type MpsResult, type Regime } from '@/lib/mps';
import type { Learned } from '@/lib/mps-data';
import type { MrpNetResult } from '@/lib/mrp-net';
import type { Forecast } from '@/lib/forecast';
import type { MpsSettings, PolicyRow } from '@/lib/mps-server';

type Product={code:string;description:string;mattressType:string;panelType:string;size:number|null;demand:number;lot:number;hoursSource:string;hours:Record<string,number>;hasTree:boolean;hasSap:boolean;cost:number|null;stock:number};
type Props={month:string;tab:string;canEdit:boolean;ready:Record<string,boolean>;products:Product[];areas:MpsArea[];groups:{key:string;name:string;maxPerDay:number;models:number;areaKey:string}[];
 policy:LaborPolicy;policies:PolicyRow[];regimes:Regime[];settings:MpsSettings;learned:Learned|null;programs:{id:number;name:string;weekday:string;total:number;models:number}[];referenceHours:number;
 workingDays:number;saturdays:number;forecast:(Forecast&{code:string})[];periods:string[];orders:any[];runs:any[];saved:any;versions:any[]};

const n0=new Intl.NumberFormat('es-EC',{maximumFractionDigits:0}),n1=new Intl.NumberFormat('es-EC',{maximumFractionDigits:1}),n2=new Intl.NumberFormat('es-EC',{maximumFractionDigits:2});
const usd=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD',maximumFractionDigits:0});
const pct=(x:number)=>`${n1.format(x*100)} %`;
const monthLabel=(m:string)=>new Date(m+'-15T12:00:00Z').toLocaleDateString('es-EC',{month:'long',year:'numeric',timeZone:'UTC'});
const shiftMonth=(m:string,d:number)=>{const [y,mo]=m.split('-').map(Number);return new Date(Date.UTC(y,mo-1+d,1)).toISOString().slice(0,7);};
const dayLabel=(d:string)=>new Date(d+'T12:00:00Z').toLocaleDateString('es-EC',{weekday:'short',day:'numeric',timeZone:'UTC'});
const CLASS_BADGE:Record<Classification,string>={OPTIMO:'badge',CON_LAS_JUSTAS:'badge warning',NO_ALCANZA:'badge error'};
const SCENARIO_LABEL:Record<string,string>={BAJA:'Demanda baja',BASE:'Demanda base',ALTA:'Demanda alta',PRONOSTICO:'Pronóstico'};
const METHOD_LABEL:Record<string,string>={DEMANDA_VIGENTE:'Demanda vigente ± variación',PROMEDIO_MOVIL:'Promedio móvil (3)',SUAVIZACION_SIMPLE:'Suavización exponencial',HOLT:'Holt (tendencia)'};

async function call(body:unknown){const res=await fetch('/api/mps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error??'No se pudo completar la operación.');return data;}
function useAction(){
 const router=useRouter();const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run<T>(label:string,body:unknown,ok?:string,refresh=false):Promise<T|null>{setBusy(label);setError('');setNotice('');try{const d=await call(body);if(ok)setNotice(ok);if(refresh)router.refresh();return d as T;}catch(e){setError(e instanceof Error?e.message:'Error');return null;}finally{setBusy('');}}
 const messages=<>{error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert" role="status">{notice}</p>}</>;
 return {busy,run,messages};
}

export function MpsManager(props:Props){
 const router=useRouter();const [tab,setTab]=useState(props.tab);
 const [result,setResult]=useState<MpsResult|null>(props.saved?.result??null);
 const [meta,setMeta]=useState<{scenario:string;regime:string;useInitialStock:boolean}>({scenario:props.saved?.scenario??'BASE',regime:props.saved?.regime??'NORMAL',useInitialStock:props.saved?.inputs?.useInitialStock??false});
 const [mrp,setMrp]=useState<MrpNetResult|null>(props.saved?.mrp??null);
 const go=(month:string)=>router.push(`/mps?month=${month}&tab=${tab}`);
 const pending=Object.entries(props.ready).filter(([,v])=>!v).length>0;
 return <>
  <div className="month-bar"><button onClick={()=>go(shiftMonth(props.month,-1))} aria-label="Mes anterior">‹</button><input type="month" value={props.month} onChange={e=>e.target.value&&go(e.target.value)}/><button onClick={()=>go(shiftMonth(props.month,1))} aria-label="Mes siguiente">›</button>
   <span className="muted"><b>{monthLabel(props.month)}</b> · {props.workingDays} días laborables · {props.saturdays} sábados · {props.products.length} códigos con demanda · {n0.format(props.products.reduce((s,p)=>s+p.demand,0))} colchones/mes</span></div>
  {pending&&<p className="alert">Vista previa: las tablas nuevas del plan maestro todavía no están creadas en Supabase. Puedes calcular y simular con tus datos; para guardar planes, políticas, pedidos especiales y versiones del aprendizaje hay que crearlas.</p>}
  {props.saved&&<p className="alert">Viendo el plan guardado <b>{props.saved.name}</b> ({props.saved.status}).</p>}
  <div className="tabs" role="tablist">
   {([['plan','Plan maestro',CalendarRange],['scenarios','Escenarios y Monte Carlo',Dices],['forecast','Pronóstico y pedidos',LineChart],['learning','Aprendizaje',BrainCircuit],['mrp','Requerimiento de materiales',PackageSearch],['params','Parámetros',SlidersHorizontal]] as const).map(([k,l,I])=>
    <button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>{setTab(k);window.history.replaceState(null,'',`/mps?month=${props.month}&tab=${k}${props.saved?`&run=${props.saved.id}`:''}`);}}><I size={15}/> {l}</button>)}
  </div>
  {tab==='plan'&&<PlanTab {...props} result={result} setResult={setResult} meta={meta} setMeta={setMeta} onMrp={()=>setTab('mrp')}/>}
  {tab==='scenarios'&&<ScenariosTab {...props}/>}
  {tab==='forecast'&&<ForecastTab {...props}/>}
  {tab==='learning'&&<LearningTab {...props}/>}
  {tab==='mrp'&&<MrpTab {...props} result={result} mrp={mrp} setMrp={setMrp}/>}
  {tab==='params'&&<ParamsTab {...props}/>}
 </>;
}

// ---------------------------------------------------------------- Plan maestro
function PlanTab(props:Props&{result:MpsResult|null;setResult:(r:MpsResult)=>void;meta:{scenario:string;regime:string;useInitialStock:boolean};setMeta:(m:any)=>void;onMrp:()=>void}){
 const {busy,run,messages}=useAction();const {result,meta}=props;const [exact,setExact]=useState(false);const [view,setView]=useState<'month'|'week'|'day'>('month');const [q,setQ]=useState('');const [type,setType]=useState('');const [name,setName]=useState('');
 async function solve(){const d=await run<{result:MpsResult}>('run',{action:'run',month:props.month,scenario:meta.scenario,regime:meta.regime,useInitialStock:meta.useInitialStock,exact});if(d)props.setResult(d.result);}
 async function save(){if(!result)return;await run('save',{action:'save',month:props.month,name,scenario:meta.scenario,regime:meta.regime,inputs:{...meta,exact},result},'Plan guardado como borrador.',true);}
 const rows=useMemo(()=>(result?.plan??[]).filter(p=>(!q||p.code.includes(q.toUpperCase())||p.description.toUpperCase().includes(q.toUpperCase()))&&(!type||p.mattressType===type||p.panelType===type)),[result,q,type]);
 const types=[...new Set(props.products.flatMap(p=>[p.mattressType,p.panelType]))].filter(t=>t&&t!=='NP').sort();
 function csv(){if(!result)return;const head=['Codigo','Descripcion','Tipo','Panel','ABC','Demanda','Producido','No cumplido',...result.days.map(d=>d.date)];
  const lines=[head,...result.plan.map(p=>[p.code,p.description,p.mattressType,p.panelType,p.abc,Math.round(p.demand),p.produced,Math.round(p.unmet),...p.daily])].map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(';')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+lines],{type:'text/csv'}));a.download=`plan-maestro-${props.month}-${meta.scenario}-${meta.regime}.csv`;a.click();}
 return <>
  <section className="panel">
   <div className="section-heading"><div><h2>Calcular el plan del mes</h2><p>Elige la demanda y la forma de trabajar. El modelo reparte la producción por día respetando el máximo por grupo, las horas de cada área y los límites legales de horas extra, y busca el menor costo de horas extra.</p></div></div>
   <div className="toolbar-row">
    <label>Demanda<select value={meta.scenario} onChange={e=>props.setMeta({...meta,scenario:e.target.value})}>{Object.entries(SCENARIO_LABEL).map(([k,l])=><option key={k} value={k}>{l}{k==='BAJA'?` (−${props.settings.demandVariation} %)`:k==='ALTA'?` (+${props.settings.demandVariation} %)`:''}</option>)}</select></label>
    <label>Forma de trabajar<select value={meta.regime} onChange={e=>props.setMeta({...meta,regime:e.target.value})}>{props.regimes.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
    <label className="inline-check"><input type="checkbox" checked={meta.useInitialStock} onChange={e=>props.setMeta({...meta,useInitialStock:e.target.checked})}/> Descontar inventario de producto terminado</label>
    <label className="inline-check"><input type="checkbox" checked={exact} onChange={e=>setExact(e.target.checked)}/> Solución entera exacta (más lenta)</label>
    <span className="spacer"/>
    <button className="primary" disabled={!!busy} onClick={solve}><Play size={16}/>{busy==='run'?'Calculando…':'Calcular plan'}</button>
   </div>
   <RegimeHint regime={props.regimes.find(r=>r.key===meta.regime)} policy={props.policy}/>
   {messages}
  </section>
  {result&&<>
   <section className="panel">
    <div className="section-heading"><div><h2>Resultado <span className={CLASS_BADGE[result.classification]}>{CLASS_LABEL[result.classification]}</span></h2>
     <p>{explain(result)}</p></div>
     <div className="toolbar-row"><button onClick={csv}>Descargar CSV</button><button onClick={props.onMrp}>Requerimiento de materiales →</button></div></div>
    <div className="metrics compact">
     <div><span>Demanda del mes</span><strong>{n0.format(result.kpis.demand)}</strong><small>colchones</small></div>
     <div><span>Plan de producción</span><strong>{n0.format(result.kpis.produced)}</strong><small>cumplimiento {pct(result.kpis.serviceLevel)}</small></div>
     <div><span>Horas extra</span><strong>{n0.format(result.kpis.overtimeHours+result.kpis.saturdayHours)}</strong><small>{n0.format(result.kpis.overtimeHours)} entre semana · {n0.format(result.kpis.saturdayHours)} sábado</small></div>
     <div><span>Costo de horas extra</span><strong>{usd.format(result.kpis.laborCost)}</strong><small>≈ {n1.format(result.kpis.extraPeopleEquivalent)} personas más</small></div>
    </div>
    <div className="metrics compact">
     <div><span>No cumplido</span><strong className={result.kpis.unmet>0.5?'text-error':''}>{n0.format(result.kpis.unmet)}</strong><small>colchones</small></div>
     <div><span>Forzado de restricciones</span><strong>{n0.format(result.kpis.forcedUnits)}</strong><small>unidades sobre el máximo · {result.kpis.forcedDays} días</small></div>
     <div><span>Modelos por día</span><strong>{n1.format(result.kpis.modelsPerDay)}</strong><small>promedio programado</small></div>
     <div><span>Costo de inventario</span><strong>{usd.format(result.kpis.holdingCost)}</strong><small>{result.status} · {n1.format(result.solveSeconds)} s</small></div>
    </div>
    <h3>Horas por área</h3>
    <div className="table-scroll"><table><thead><tr><th>Área</th><th className="number">Personas presentes</th><th className="number">Rendimiento</th><th className="number">Horas estándar del plan</th><th className="number">Horas ordinarias</th><th className="number">Extra entre semana</th><th className="number">Uso del tope legal</th><th className="number">Sábado</th><th className="number">Costo</th></tr></thead>
     <tbody>{result.areas.map(a=><tr key={a.key}><td>{a.name}</td><td className="number">{n1.format(a.present)}</td><td className="number">{n2.format(a.efficiency)}</td><td className="number">{n0.format(a.requiredHours)}</td><td className="number">{n0.format(a.regularHours)}</td><td className="number">{n0.format(a.overtimeHours)}</td><td className="number">{pct(a.overtimeUse)}</td><td className="number">{n0.format(a.saturdayHours)}</td><td className="number">{usd.format(a.overtimeCost+a.saturdayCost)}</td></tr>)}</tbody></table></div>
    <p className="footnote">Rendimiento = horas estándar que el área realmente saca por hora trabajada, aprendido de los programas reales y multiplicado por la forma de trabajar. Uso del tope legal = horas extra usadas ÷ máximo permitido ({props.policy.maxOvertimeDay} h/día, {props.policy.maxOvertimeWeek} h/semana por persona). Un área al 100 % es el cuello de botella.</p>
    {result.areas.some(a=>a.shifts?.length>1)&&<><h3>Horas extra por turno</h3>
    <div className="table-scroll short"><table><thead><tr><th>Área</th><th>Turno</th><th className="number">Personas presentes</th><th className="number">Productividad</th><th className="number">Extra entre semana</th><th className="number">Sábado</th><th className="number">Costo</th></tr></thead>
     <tbody>{result.areas.flatMap(a=>(a.shifts??[]).map(sh=><tr key={a.key+sh.key}><td>{a.name}</td><td>{sh.name}</td><td className="number">{n1.format(sh.present)}</td><td className="number">{pct(sh.productivity)}</td><td className="number">{n0.format(sh.overtimeHours)}</td><td className="number">{n0.format(sh.saturdayHours)}</td><td className="number">{usd.format(sh.overtimeCost+sh.saturdayCost)}</td></tr>))}</tbody></table></div>
    <p className="footnote">El modelo pone la hora extra donde sale más barata por colchón: el turno de noche rinde menos y su hora lleva recargo nocturno, por eso se usa después del de día.</p></>}
    <h3>Máximo diario por grupo</h3>
    <div className="table-scroll"><table><thead><tr><th>Grupo</th><th className="number">Máximo/día</th>{result.days.map(d=><th key={d.date} className="number">{dayLabel(d.date)}</th>)}</tr></thead>
     <tbody>{result.groups.map(g=><tr key={g.key}><td>{g.name}</td><td className="number">{n0.format(g.maxPerDay)}</td>{g.daily.map((d,i)=><td key={i} className="number" style={heat(d.planned,d.capacity,d.forced)} title={`Programado ${n0.format(d.planned)} · capacidad del día ${n0.format(d.capacity)}${d.forced>0.5?` · forzado ${n0.format(d.forced)}`:''}`}>{n0.format(d.planned)}</td>)}</tr>)}</tbody></table></div>
   </section>
   <section className="panel">
    <div className="section-heading"><div><h2>Plan por código SAP</h2><p>Mensual, semanal (con la meta de cada semana) o diario. A = se programa todas las semanas, B = cada dos semanas, C = una vez al mes.</p></div>
     <div className="toolbar-row">{(['month','week','day'] as const).map(v=><button key={v} className={view===v?'selected-tool':''} onClick={()=>setView(v)}>{v==='month'?'Mensual':v==='week'?'Semanal':'Diario'}</button>)}
      <input placeholder="Buscar código o nombre" value={q} onChange={e=>setQ(e.target.value)}/><select value={type} onChange={e=>setType(e.target.value)}><option value="">Todas las letras</option>{types.map(t=><option key={t}>{t}</option>)}</select></div></div>
    <div className="table-scroll tall"><table><thead><tr><th>Código</th><th>Descripción</th><th>Letra</th><th>ABC</th>
     {view==='month'&&<><th className="number">Demanda</th><th className="number">Plan</th><th className="number">No cumplido</th><th className="number">Lote</th><th>Tiempos</th></>}
     {view==='week'&&result.weeks.map((w,i)=><th key={w} className="number">Sem. {dayLabel(w)}<br/><small>meta</small></th>)}
     {view==='day'&&result.days.map(d=><th key={d.date} className="number">{dayLabel(d.date)}</th>)}</tr></thead>
     <tbody>{rows.map(p=><tr key={p.code}><td className="mono">{p.code}</td><td>{p.description}</td><td>{p.mattressType}{p.panelType!=='NP'?` · ${p.panelType}`:''}</td><td>{p.abc}</td>
      {view==='month'&&<><td className="number">{n0.format(p.demand)}</td><td className="number">{n0.format(p.produced)}</td><td className={`number ${p.unmet>0.5?'text-error':''}`}>{n0.format(p.unmet)}</td><td className="number">{p.lot}</td><td>{p.hoursSource==='RUTA'?'Hoja de ruta':p.hoursSource==='ESTIMADO'?<span className="badge warning">Estimado</span>:<span className="badge error">Sin dato</span>}</td></>}
      {view==='week'&&p.weekly.map((x,i)=><td key={i} className="number">{x?n0.format(x):'·'}<br/><small className="muted">{n0.format(p.weeklyDemand[i])}</small></td>)}
      {view==='day'&&p.daily.map((x,i)=><td key={i} className="number">{x?n0.format(x):'·'}</td>)}</tr>)}</tbody>
     <tfoot><tr><td colSpan={4}>Total ({rows.length} códigos)</td>
      {view==='month'&&<><td className="number">{n0.format(rows.reduce((s,p)=>s+p.demand,0))}</td><td className="number">{n0.format(rows.reduce((s,p)=>s+p.produced,0))}</td><td className="number">{n0.format(rows.reduce((s,p)=>s+p.unmet,0))}</td><td/><td/></>}
      {view==='week'&&result.weeks.map((_,i)=><td key={i} className="number">{n0.format(rows.reduce((s,p)=>s+p.weekly[i],0))}<br/><small className="muted">{n0.format(rows.reduce((s,p)=>s+p.weeklyDemand[i],0))}</small></td>)}
      {view==='day'&&result.days.map((_,i)=><td key={i} className="number">{n0.format(rows.reduce((s,p)=>s+p.daily[i],0))}</td>)}</tr></tfoot></table></div>
    {props.canEdit&&<div className="toolbar-row end"><input placeholder="Nombre del plan (opcional)" value={name} onChange={e=>setName(e.target.value)}/><button className="primary" disabled={!!busy||!props.ready.runs} title={props.ready.runs?'':'Requiere crear las tablas nuevas'} onClick={save}><Save size={16}/>Guardar como borrador</button></div>}
   </section></>}
  <SavedRuns runs={props.runs} month={props.month} canEdit={props.canEdit}/>
 </>;
}
const heat=(planned:number,cap:number,forced:number)=>{const u=cap>0?planned/cap:0;return {background:forced>0.5?'#f6d9dc':u>0.98?'#cde0c9':u>0.7?'#e7f1e4':undefined};};
function explain(r:MpsResult){
 const top=[...r.areas].sort((a,b)=>b.overtimeUse-a.overtimeUse)[0];
 if(r.classification==='OPTIMO')return 'Se cumple toda la demanda dentro de la jornada, sin sábados ni forzar restricciones.';
 if(r.classification==='CON_LAS_JUSTAS')return `Se cumple la demanda, pero solo con ${n0.format(r.kpis.overtimeHours+r.kpis.saturdayHours)} horas extra${r.kpis.saturdayHours>0.5?' y sábados':''}${r.kpis.forcedUnits>0.5?' y forzando restricciones':''}. ${top?`El área más exigida es ${top.name} (${pct(top.overtimeUse)} del tope legal de horas extra).`:''}`;
 return `No alcanza: faltan ${n0.format(r.kpis.unmet)} colchones (${pct(1-r.kpis.serviceLevel)} de la demanda). ${top?`El cuello de botella es ${top.name}: usa ${pct(top.overtimeUse)} del tope legal de horas extra.`:''} Prueba con otra forma de trabajar o revisa personal y rendimiento.`;
}
function RegimeHint({regime,policy}:{regime?:Regime;policy:LaborPolicy}){
 if(!regime)return null;
 return <p className="footnote">{regime.label}: rendimiento × {n2.format(regime.efficiencyFactor)}, forzado de restricciones hasta {n0.format(regime.forcingPct)} %, horas extra hasta {policy.maxOvertimeDay} h/día y {policy.maxOvertimeWeek} h/semana por persona{regime.saturday&&policy.saturdayEnabled?`, sábados hasta ${policy.saturdayMaxHours} h`:', sin sábados'}. Valor hora {usd.format(policy.baseSalary/policy.monthlyHours)} (+{policy.overtimeSurchargePct} % entre semana, +{policy.extraordinarySurchargePct} % sábado).</p>;
}
function SavedRuns({runs,month,canEdit}:{runs:any[];month:string;canEdit:boolean}){
 const {busy,run,messages}=useAction();
 if(!runs.length)return null;
 return <section className="panel"><h2>Planes guardados</h2>{messages}
  <div className="table-scroll short"><table><thead><tr><th>Nombre</th><th>Mes</th><th>Demanda</th><th>Forma</th><th>Resultado</th><th>Estado</th><th>Creado</th><th/></tr></thead>
   <tbody>{runs.map(r=><tr key={r.id}><td><a href={`/mps?month=${String(r.month).slice(0,7)}&run=${r.id}`}>{r.name}</a></td><td>{String(r.month).slice(0,7)}</td><td>{SCENARIO_LABEL[r.scenario]??r.scenario}</td><td>{r.regime}</td><td><span className={CLASS_BADGE[r.classification as Classification]}>{CLASS_LABEL[r.classification as Classification]}</span></td><td>{r.status}</td><td>{new Date(r.created_at).toLocaleString('es-EC',{timeZone:'America/Guayaquil'})}</td>
    <td>{canEdit&&r.status==='BORRADOR'&&<button className="compact-button" disabled={!!busy} onClick={()=>run('approve',{action:'approve',id:r.id},'Plan aprobado.',true)}>Aprobar</button>}</td></tr>)}</tbody></table></div></section>;
}

// ---------------------------------------------------------------- Escenarios
function ScenariosTab(props:Props){
 const {busy,run,messages}=useAction();const [matrix,setMatrix]=useState<any[]|null>(null);const [stock,setStock]=useState(false);
 const [mc,setMc]=useState<MonteCarloSummary|null>(null);const [mcForm,setMcForm]=useState({regime:'NORMAL',runs:40,variationPct:props.settings.demandVariation,absenteeismMin:props.settings.absenteeism.min,absenteeismMax:props.settings.absenteeism.max});
 const [mcAll,setMcAll]=useState<Record<string,MonteCarloSummary>>({});
 async function runMatrix(){const d=await run<{matrix:any[]}>('matrix',{action:'matrix',month:props.month,useInitialStock:stock});if(d)setMatrix(d.matrix);}
 async function runMc(){const d=await run<{montecarlo:MonteCarloSummary}>('mc',{action:'montecarlo',month:props.month,...mcForm,useInitialStock:stock});if(d){setMc(d.montecarlo);setMcAll({...mcAll,[mcForm.regime]:d.montecarlo});}}
 const cell=(s:string,r:string)=>matrix?.find(x=>x.scenario===s&&x.regime===r);
 return <>
  <section className="panel">
   <div className="section-heading"><div><h2>Matriz de escenarios</h2><p>Cruza tres niveles de demanda (baja −{props.settings.demandVariation} %, base, alta +{props.settings.demandVariation} %) con tres formas de trabajar. Cada celda dice si se cumple la demanda, con cuántas horas extra y qué tan forzado.</p></div>
    <div className="toolbar-row"><label className="inline-check"><input type="checkbox" checked={stock} onChange={e=>setStock(e.target.checked)}/> Descontar inventario</label><button className="primary" disabled={!!busy} onClick={runMatrix}><Play size={16}/>{busy==='matrix'?'Calculando 9 escenarios…':'Calcular matriz'}</button></div></div>
   {messages}
   {matrix&&<div className="table-scroll"><table className="scenario-matrix"><thead><tr><th>Demanda \ Forma de trabajar</th>{props.regimes.map(r=><th key={r.key}>{r.label}</th>)}</tr></thead>
    <tbody>{['BAJA','BASE','ALTA'].map(s=><tr key={s}><th>{SCENARIO_LABEL[s]}</th>{props.regimes.map(r=>{const c=cell(s,r.key);return <td key={r.key} className={`scenario-cell ${c?.classification??''}`}>{c&&<>
     <strong>{CLASS_LABEL[c.classification as Classification]}</strong>
     <span>Cumple {pct(c.kpis.serviceLevel)} · faltan {n0.format(c.kpis.unmet)}</span>
     <span>{n0.format(c.kpis.overtimeHours)} h extra · {n0.format(c.kpis.saturdayHours)} h sábado</span>
     <span>{usd.format(c.kpis.laborCost)} · forzado {n0.format(c.kpis.forcedUnits)}</span>
     <small>Cuello de botella: {[...c.areas].sort((a:any,b:any)=>b.overtimeUse-a.overtimeUse)[0]?.name}</small></>}</td>;})}</tr>)}</tbody></table></div>}
   <p className="footnote">Óptimo: se cumple sin sábados ni forzar y con horas extra ≤ 5 % de las ordinarias. Con las justas: se cumple solo con horas extra altas, sábados o forzando. No alcanza: queda demanda sin cumplir aun así.</p>
  </section>
  <section className="panel">
   <div className="section-heading"><div><h2>Simulación Monte Carlo</h2><p>Repite el plan muchas veces con demanda y ausentismo al azar dentro de los rangos, para estimar la probabilidad de cumplir con cada forma de trabajar.</p></div></div>
   <div className="toolbar-row">
    <label>Forma de trabajar<select value={mcForm.regime} onChange={e=>setMcForm({...mcForm,regime:e.target.value})}>{props.regimes.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
    <label>Corridas<input className="narrow" type="number" min={5} max={200} value={mcForm.runs} onChange={e=>setMcForm({...mcForm,runs:Number(e.target.value)})}/></label>
    <label>Variación demanda ±%<input className="narrow" type="number" value={mcForm.variationPct} onChange={e=>setMcForm({...mcForm,variationPct:Number(e.target.value)})}/></label>
    <label>Ausentismo mín. %<input className="narrow" type="number" value={mcForm.absenteeismMin} onChange={e=>setMcForm({...mcForm,absenteeismMin:Number(e.target.value)})}/></label>
    <label>Ausentismo máx. %<input className="narrow" type="number" value={mcForm.absenteeismMax} onChange={e=>setMcForm({...mcForm,absenteeismMax:Number(e.target.value)})}/></label>
    <span className="spacer"/><button className="primary" disabled={!!busy} onClick={runMc}><Dices size={16}/>{busy==='mc'?'Simulando…':'Simular'}</button></div>
   {mc&&<div className="metrics compact">
    <div><span>Probabilidad de cumplir</span><strong>{pct(mc.meetProbability)}</strong><small>{mc.classes.OPTIMO} óptimo · {mc.classes.CON_LAS_JUSTAS} con las justas · {mc.classes.NO_ALCANZA} no alcanza</small></div>
    <div><span>Cumplimiento promedio</span><strong>{pct(mc.serviceLevel.mean)}</strong><small>P10 {pct(mc.serviceLevel.p10)} · P90 {pct(mc.serviceLevel.p90)}</small></div>
    <div><span>Horas extra</span><strong>{n0.format(mc.overtimeHours.mean+mc.saturdayHours.mean)}</strong><small>P10 {n0.format(mc.overtimeHours.p10+mc.saturdayHours.p10)} · P90 {n0.format(mc.overtimeHours.p90+mc.saturdayHours.p90)}</small></div>
    <div><span>Costo de horas extra</span><strong>{usd.format(mc.laborCost.mean)}</strong><small>P90 {usd.format(mc.laborCost.p90)}</small></div></div>}
   {Object.keys(mcAll).length>1&&<div className="table-scroll"><table><thead><tr><th>Forma de trabajar</th><th className="number">Corridas</th><th className="number">P(cumplir)</th><th className="number">Cumplimiento medio</th><th className="number">Faltante medio</th><th className="number">Horas extra medias</th><th className="number">Costo medio</th></tr></thead>
    <tbody>{Object.entries(mcAll).map(([k,s])=><tr key={k}><td>{props.regimes.find(r=>r.key===k)?.label}</td><td className="number">{s.runs}</td><td className="number">{pct(s.meetProbability)}</td><td className="number">{pct(s.serviceLevel.mean)}</td><td className="number">{n0.format(s.unmet.mean)}</td><td className="number">{n0.format(s.overtimeHours.mean+s.saturdayHours.mean)}</td><td className="number">{usd.format(s.laborCost.mean)}</td></tr>)}</tbody></table></div>}
  </section></>;
}

// ---------------------------------------------------------------- Pronóstico y pedidos
function ForecastTab(props:Props){
 const {busy,run,messages}=useAction();const [order,setOrder]=useState({material_code:'',due_date:`${props.month}-15`,quantity:'',customer:'',notes:''});const [q,setQ]=useState('');
 const map=new Map(props.products.map(p=>[p.code,p]));
 const rows=props.forecast.filter(f=>!q||f.code.includes(q.toUpperCase())||map.get(f.code)?.description.toUpperCase().includes(q.toUpperCase())).sort((a,b)=>b.point-a.point);
 const tot=(k:'point'|'low'|'high')=>props.forecast.reduce((s,f)=>s+f[k],0);
 return <>
  <section className="panel">
   <div className="section-heading"><div><h2>Pronóstico de la demanda</h2><p>Cada mes que registres la demanda queda como historia. Con 3 meses o más, el sistema prueba promedio móvil, suavización exponencial y Holt para cada código y se queda con el de menor error; con menos historia usa la demanda vigente ± {props.settings.demandVariation} %.</p></div>
    {props.canEdit&&<button className="primary" disabled={!!busy||!props.ready.observations} title={props.ready.observations?'':'Requiere crear las tablas nuevas'} onClick={()=>run('observe',{action:'observe',month:props.month},`Demanda vigente registrada como historia de ${monthLabel(props.month)}.`,true)}>Registrar demanda vigente como {monthLabel(props.month)}</button>}</div>
   {messages}
   <div className="metrics compact"><div><span>Meses de historia</span><strong>{props.periods.length}</strong><small>{props.periods.join(' · ')||'todavía ninguno'}</small></div><div><span>Escenario bajo</span><strong>{n0.format(tot('low'))}</strong><small>colchones/mes</small></div><div><span>Pronóstico</span><strong>{n0.format(tot('point'))}</strong><small>colchones/mes</small></div><div><span>Escenario alto</span><strong>{n0.format(tot('high'))}</strong><small>colchones/mes</small></div></div>
   <input placeholder="Buscar código o nombre" value={q} onChange={e=>setQ(e.target.value)}/>
   <div className="table-scroll tall"><table><thead><tr><th>Código</th><th>Descripción</th><th>Método</th><th className="number">Meses</th><th className="number">Bajo</th><th className="number">Pronóstico</th><th className="number">Alto</th><th className="number">Error medio</th></tr></thead>
    <tbody>{rows.map(f=><tr key={f.code}><td className="mono">{f.code}</td><td>{map.get(f.code)?.description}</td><td>{METHOD_LABEL[f.method]}{f.alpha!==undefined?` α=${f.alpha}`:''}{f.beta!==undefined?` β=${f.beta}`:''}</td><td className="number">{f.observations}</td><td className="number">{n0.format(f.low)}</td><td className="number">{n0.format(f.point)}</td><td className="number">{n0.format(f.high)}</td><td className="number">{f.error===null?'—':n1.format(f.error)}</td></tr>)}</tbody></table></div>
  </section>
  <section className="panel">
   <h2>Pedidos especiales</h2><p>Se suman a la demanda en la semana de su fecha de entrega. Un código que no está en la demanda también entra al plan, pero si no tiene BOM ni hoja de ruta se marca para completarlo.</p>
   {props.canEdit&&<div className="bom-form-grid">
    <label>Código SAP<input value={order.material_code} onChange={e=>setOrder({...order,material_code:e.target.value.toUpperCase()})} placeholder="3C80595"/></label>
    <label>Fecha de entrega<input type="date" value={order.due_date} onChange={e=>setOrder({...order,due_date:e.target.value})}/></label>
    <label>Cantidad<input type="number" min={1} value={order.quantity} onChange={e=>setOrder({...order,quantity:e.target.value})}/></label>
    <label>Cliente<input value={order.customer} onChange={e=>setOrder({...order,customer:e.target.value})}/></label>
    <label className="span-2">Nota<input value={order.notes} onChange={e=>setOrder({...order,notes:e.target.value})}/></label>
    <div><button className="primary" disabled={!!busy||!props.ready.orders} onClick={()=>run('order',{action:'order',...order},'Pedido especial agregado.',true)}>Agregar pedido</button></div></div>}
   {order.material_code&&!map.has(order.material_code)&&<p className="alert">El código {order.material_code} no está en la demanda vigente: revisa que tenga BOM y hoja de ruta.</p>}
   <div className="table-scroll short"><table><thead><tr><th>Código</th><th>Entrega</th><th className="number">Cantidad</th><th>Cliente</th><th>Nota</th><th/></tr></thead>
    <tbody>{props.orders.map(o=><tr key={o.id}><td className="mono">{o.material_code}</td><td>{o.due_date}</td><td className="number">{n0.format(Number(o.quantity))}</td><td>{o.customer}</td><td>{o.notes}</td><td>{props.canEdit&&<button className="compact-button" onClick={()=>run('close',{action:'order-close',id:o.id},'Pedido cerrado.',true)}>Cerrar</button>}</td></tr>)}
     {!props.orders.length&&<tr><td colSpan={6} className="muted">Sin pedidos especiales abiertos.</td></tr>}</tbody></table></div>
  </section></>;
}

// ---------------------------------------------------------------- Aprendizaje
function LearningTab(props:Props){
 const {busy,run,messages}=useAction();const l=props.learned;const name=(k:string)=>props.areas.find(a=>a.key===k)?.name??k;
 if(!l)return <section className="panel"><h2>Aprendizaje</h2><p className="empty-state">Sube programas reales en Entrenamiento para que el plan aprenda el rendimiento, el forzado y el tamaño de lote del programador.</p></section>;
 return <>
  <section className="panel">
   <div className="section-heading"><div><h2>Lo aprendido de {l.programs} programas reales</h2><p>Cada programa del programador dice cuánto trabajo pone en un día. Comparando sus horas estándar con las horas de los turnos del día ({props.settings.shifts.filter(x=>x.active).map(x=>`${x.name} ${x.referenceHours??props.referenceHours} h al ${x.productivityPct} %`).join(' + ')}) y el personal presente, se mide el rendimiento real que asume para cada área. Con más programas, los valores se vuelven más confiables.</p></div>
    {props.canEdit&&<button className="primary" disabled={!!busy||!props.ready.settings} onClick={()=>run('learn',{action:'learn-save',month:props.month},'Versión del aprendizaje guardada.',true)}>Guardar versión</button>}</div>
   {messages}
   <div className="metrics compact"><div><span>Volumen por día</span><strong>{n0.format(l.volume.mean)}</strong><small>entre {n0.format(l.volume.min)} y {n0.format(l.volume.max)}</small></div><div><span>Modelos por día</span><strong>{n1.format(l.modelsPerDay)}</strong><small>promedio</small></div><div><span>Lote típico</span><strong>{l.lot}</strong><small>múltiplo de las cantidades</small></div><div><span>Mezcla</span><strong className="metric-text">{Object.entries(l.shareByType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${n0.format(v*100)}%`).join(' · ')}</strong><small>por tipo de colchón</small></div></div>
   <h3>Rendimiento por área (horas estándar programadas ÷ horas disponibles)</h3>
   <div className="table-scroll"><table><thead><tr><th>Área</th><th className="number">Promedio (Normal)</th><th className="number">Percentil 75</th><th className="number">Máximo</th><th>Por programa</th></tr></thead>
    <tbody>{Object.entries(l.efficiency).map(([k,v])=><tr key={k}><td>{name(k)}</td><td className="number">{n2.format(v.mean)}</td><td className="number">{n2.format(v.p75)}</td><td className="number">{n2.format(v.max)}</td><td>{v.samples.map(x=>n2.format(x)).join(' · ')}</td></tr>)}</tbody></table></div>
   <p className="footnote">Un valor mayor que 1 significa que el programador pone más trabajo estándar del que el personal registrado haría a ritmo estándar: o el equipo trabaja más rápido que el estándar, o hay más personas de las registradas, o los tiempos de la hoja de ruta están holgados. Conviene confirmarlo con el personal real y la producción real.</p>
   <h3>Forzado de restricciones</h3>
   <div className="table-scroll"><table><thead><tr><th>Grupo</th><th className="number">Máximo/día</th><th className="number">Exceso promedio</th><th className="number">Exceso máximo</th><th className="number">Programas que lo pasan</th></tr></thead>
    <tbody>{props.groups.map(g=>{const f=l.forcing[g.key];return <tr key={g.key}><td>{g.name}</td><td className="number">{g.maxPerDay}</td><td className="number">{n1.format(f?.mean??0)} %</td><td className="number">{n1.format(f?.max??0)} %</td><td className="number">{f?.timesOver??0} de {l.programs}</td></tr>;})}</tbody></table></div>
   <h3>Formas de trabajar que salen de lo aprendido</h3>
   <div className="table-scroll"><table><thead><tr><th>Forma</th><th className="number">Rendimiento ×</th><th className="number">Forzado máx.</th><th>Sábados</th></tr></thead>
    <tbody>{props.regimes.map(r=><tr key={r.key}><td>{r.label}</td><td className="number">{n2.format(r.efficiencyFactor)}</td><td className="number">{n0.format(r.forcingPct)} %</td><td>{r.saturday?'Sí':'No'}</td></tr>)}</tbody></table></div>
  </section>
  <section className="panel"><h2>Programas usados</h2>
   <div className="table-scroll short"><table><thead><tr><th>Programa</th><th>Día</th><th className="number">Colchones</th><th className="number">Modelos</th></tr></thead><tbody>{props.programs.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.weekday}</td><td className="number">{n0.format(p.total)}</td><td className="number">{p.models}</td></tr>)}</tbody></table></div>
   {props.versions.length>0&&<><h3>Versiones guardadas</h3>{props.versions.map(v=><p key={v.id}>{new Date(v.created_at).toLocaleString('es-EC',{timeZone:'America/Guayaquil'})} · {v.programs} programas {v.notes?`· ${v.notes}`:''}</p>)}</>}
  </section></>;
}

// ---------------------------------------------------------------- MRP
function MrpTab(props:Props&{result:MpsResult|null;mrp:MrpNetResult|null;setMrp:(m:MrpNetResult)=>void}){
 const {busy,run,messages}=useAction();const {result,mrp}=props;const [origin,setOrigin]=useState('');const [q,setQ]=useState('');
 async function calc(){if(!result)return;const d=await run<{mrp:MrpNetResult}>('mrp',{action:'mrp',month:props.month,weeks:result.weeks,plan:result.plan.map(p=>({code:p.code,description:p.description,weekly:p.weekly}))});if(d)props.setMrp(d.mrp);}
 if(!result)return <section className="panel"><h2>Requerimiento de materiales</h2><p className="empty-state">Primero calcula un plan en la pestaña Plan maestro (o abre un plan guardado).</p></section>;
 const mats=(mrp?.sapMaterials??[]).filter(m=>(!origin||m.origin===origin)&&(!q||m.code.includes(q.toUpperCase())||m.description.toUpperCase().includes(q.toUpperCase())));
 return <>
  <section className="panel">
   <div className="section-heading"><div><h2>Requerimiento de materiales del plan</h2><p>Explota el plan semanal con el árbol BOM de ingeniería (todos los niveles) y con la lista de materiales SAP, que trae también pegas, hilos, gomas, grapas y etiquetas. Luego descuenta el inventario y el stock en tránsito.</p></div>
    <button className="primary" disabled={!!busy} onClick={calc}><Play size={16}/>{busy==='mrp'?'Calculando…':'Calcular requerimiento'}</button></div>
   {messages}
   {mrp&&<>{mrp.alerts.map(a=><p key={a} className="alert">{a}</p>)}
    <div className="metrics compact"><div><span>Códigos del plan</span><strong>{mrp.coverage.length}</strong><small>{mrp.coverage.filter(c=>c.tree).length} con árbol BOM · {mrp.coverage.filter(c=>c.sap).length} con lista SAP</small></div>
     <div><span>Componentes del BOM</span><strong>{mrp.bomComponents.length}</strong><small>estructura de ingeniería</small></div>
     <div><span>Materiales SAP</span><strong>{mrp.sapMaterials.length}</strong><small>{mrp.sapMaterials.filter(m=>m.origin==='COMPLEMENTARIO').length} solo en lista SAP</small></div>
     <div><span>Con compra neta</span><strong>{mrp.sapMaterials.filter(m=>m.net>0).length}</strong><small>después del inventario</small></div></div></>}
  </section>
  {mrp&&<>
   <section className="panel"><h2>A. Componentes del árbol BOM</h2><p>Cantidad acumulada desde la raíz (cantidad del componente × la de sus padres) por las unidades planificadas de cada colchón.</p>
    <div className="table-scroll tall"><table><thead><tr><th>Nivel</th><th>Componente</th><th>Tipo</th><th>Material SAP</th><th className="number">Lead time</th>{mrp.weeks.map(w=><th key={w} className="number">Sem. {dayLabel(w)}</th>)}<th className="number">Total</th><th className="number">Colchones</th></tr></thead>
     <tbody>{mrp.bomComponents.map(c=><tr key={c.name+c.unit}><td>{c.level}</td><td>{c.name}</td><td>{c.type??''}</td><td className="mono">{c.materialCode??<span className="muted">sin vincular</span>}</td><td className="number">{c.leadTime??'—'}</td>{c.weekly.map((x,i)=><td key={i} className="number">{n0.format(x)}</td>)}<td className="number">{n0.format(c.total)} {c.unit}</td><td className="number">{c.products.length}</td></tr>)}</tbody></table></div></section>
   <section className="panel"><div className="section-heading"><div><h2>B. Materiales SAP (incluye consumibles)</h2><p>Necesidad bruta por semana, inventario, necesidad neta y semana en que hay que pedir según el lead time del maestro de materiales.</p></div>
     <div className="toolbar-row"><select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">Todos</option><option value="BOM">Vinculados al árbol BOM</option><option value="COMPLEMENTARIO">Solo en lista SAP (pegas, hilos…)</option></select><input placeholder="Buscar" value={q} onChange={e=>setQ(e.target.value)}/></div></div>
    <div className="table-scroll tall"><table><thead><tr><th>Código</th><th>Descripción</th><th>Origen</th>{mrp.weeks.map(w=><th key={w} className="number">Sem. {dayLabel(w)}</th>)}<th className="number">Bruta</th><th className="number">Inventario</th><th className="number">Tránsito</th><th className="number">Neta</th><th>Pedir en</th><th className="number">Compra</th></tr></thead>
     <tbody>{mats.slice(0,800).map(m=><tr key={m.code+m.unit}><td className="mono">{m.code}</td><td>{m.description}</td><td>{m.origin==='BOM'?'BOM':'Lista SAP'}</td>{m.weekly.map((x,i)=><td key={i} className="number">{n1.format(x)}</td>)}<td className="number">{n1.format(m.gross)} {m.unit}</td><td className="number">{n1.format(m.stock)}</td><td className="number">{n1.format(m.inTransit)}</td><td className={`number ${m.net>0?'text-error':''}`}>{n1.format(m.net)}</td><td>{m.releaseWeek===null?'—':m.releaseWeek<0?<span className="badge error">Atrasado {-m.releaseWeek} sem.</span>:`Sem. ${dayLabel(mrp.weeks[m.releaseWeek])}`}</td><td className="number">{m.purchaseQuantity===null?'—':`${n0.format(m.purchaseQuantity)} ${m.purchaseUnit??''}`}</td></tr>)}</tbody></table></div>
    {mats.length>800&&<p className="footnote">Se muestran 800 de {mats.length}; usa el buscador.</p>}</section>
   <NodeMapper {...props} codes={mrp.coverage.filter(c=>c.tree&&c.sap).map(c=>c.code)}/>
  </>}</>;
}
function NodeMapper(props:Props&{codes:string[]}){
 const {busy,run,messages}=useAction();const [code,setCode]=useState('');const [data,setData]=useState<any>(null);
 async function open(c:string){setCode(c);setData(c?await run('tree',{action:'tree',code:c}):null);}
 const map=new Map<number,string>((data?.maps??[]).map((m:any)=>[Number(m.node_id),m.material_code]));
 return <section className="panel"><h2>Vincular componentes del árbol con materiales SAP</h2>
  <p>Así el sistema sabe qué materiales de la lista SAP ya son componentes del árbol y cuáles son consumibles adicionales, sin contar nada dos veces. Los árboles no se modifican.</p>
  <select value={code} onChange={e=>open(e.target.value)}><option value="">Elige un colchón con árbol y lista SAP</option>{props.codes.map(c=><option key={c}>{c}</option>)}</select>
  {messages}
  {data?.tree&&<div className="table-scroll short"><table><thead><tr><th>Componente</th><th className="number">Cantidad</th><th>Material SAP</th></tr></thead>
   <tbody>{data.tree.nodes.map((n:any)=><tr key={n.id}><td>{n.name}</td><td className="number">{n2.format(n.quantity)} {n.unit??''}</td><td>
    <select disabled={!props.canEdit||!data.mapsReady||!!busy} value={map.get(n.id)??''} onChange={async e=>{await run('map',e.target.value?{action:'node-map',node_id:n.id,material_code:e.target.value}:{action:'node-map-delete',node_id:n.id},'Vínculo guardado.');await open(code);}}>
     <option value="">— sin vincular —</option>{(data.list?.items??[]).map((i:any)=><option key={i.code} value={i.code}>{i.code} · {i.description}</option>)}</select></td></tr>)}</tbody></table></div>}
 </section>;
}

// ---------------------------------------------------------------- Parámetros
function ParamsTab(props:Props){
 const {busy,run,messages}=useAction();const s=props.settings;const [costs,setCosts]=useState(s.costs);const [regimes,setRegimes]=useState(s.regimes);const [abs,setAbs]=useState(s.absenteeism);const [variation,setVariation]=useState(s.demandVariation);const [wheel,setWheel]=useState(s.wheel);const [lot,setLot]=useState(s.lot);
 const save=(key:string,value:unknown)=>run(key,{action:'settings',key,value},'Parámetro guardado.',true);
 const dis=!props.canEdit||!props.ready.settings||!!busy;
 return <>
  <section className="panel"><h2>Política laboral vigente</h2>
   <p>Sueldo básico {usd.format(props.policy.baseSalary)} · valor hora {usd.format(props.policy.baseSalary/props.policy.monthlyHours)} · suplementarias +{props.policy.overtimeSurchargePct} % (máx. {props.policy.maxOvertimeDay} h/día, {props.policy.maxOvertimeWeek} h/semana) · sábados {props.policy.saturdayEnabled?`sí, hasta ${props.policy.saturdayMaxHours} h, +${props.policy.extraordinarySurchargePct} %`:'no'}.</p>
   <p><a href="/restrictions?tab=policy">Editar en Restricciones → Políticas laborales</a></p></section>
  <section className="panel"><h2>Turnos</h2>
   <p>{s.shifts.filter(x=>x.active).map(x=>`${x.name}: productividad ${x.productivityPct} %${x.nightSurchargePct>0?`, recargo nocturno ${x.nightSurchargePct} %`:''}${x.saturday?', trabaja sábado':''}`).join(' · ')}.</p>
   <p><a href="/restrictions?tab=shifts">Editar en Restricciones → Turnos</a></p></section>
  <section className="panel"><h2>Costos y penalizaciones</h2>{messages}
   <div className="bom-form-grid">
    <label>Costo de inventario (% mensual del costo)<input type="number" step="0.1" value={costs.holdingPctMonthly} onChange={e=>setCosts({...costs,holdingPctMonthly:Number(e.target.value)})}/></label>
    <label>Atraso dentro del mes (USD por colchón y semana)<input type="number" value={costs.backlogPenalty} onChange={e=>setCosts({...costs,backlogPenalty:Number(e.target.value)})}/></label>
    <label>Demanda no cumplida al cierre (USD por colchón)<input type="number" value={costs.unmetPenalty} onChange={e=>setCosts({...costs,unmetPenalty:Number(e.target.value)})}/></label>
    <label>Forzar una restricción (USD por colchón)<input type="number" value={costs.forcingPenalty} onChange={e=>setCosts({...costs,forcingPenalty:Number(e.target.value)})}/></label></div>
   <p className="footnote">Las penalizaciones deben ser mayores que el costo de horas extra de un colchón, para que el modelo prefiera cumplir con horas extra antes que dejar demanda sin cumplir.</p>
   <div className="toolbar-row end"><button className="primary" disabled={dis} onClick={()=>save('costs',costs)}>Guardar costos</button></div></section>
  <section className="panel"><h2>Formas de trabajar (mínimos)</h2><p>Lo aprendido de los programas puede subir estos valores, nunca bajarlos.</p>
   <div className="table-scroll"><table><thead><tr><th>Forma</th><th>Rendimiento ×</th><th>Forzado máx. %</th><th>Sábados</th></tr></thead><tbody>{regimes.map((r,i)=><tr key={r.key}><td>{r.label}</td>
    <td><input className="narrow" type="number" step="0.05" value={r.efficiencyFactor} onChange={e=>setRegimes(regimes.map((x,j)=>j===i?{...x,efficiencyFactor:Number(e.target.value)}:x))}/></td>
    <td><input className="narrow" type="number" value={r.forcingPct} onChange={e=>setRegimes(regimes.map((x,j)=>j===i?{...x,forcingPct:Number(e.target.value)}:x))}/></td>
    <td><input type="checkbox" checked={r.saturday} onChange={e=>setRegimes(regimes.map((x,j)=>j===i?{...x,saturday:e.target.checked}:x))}/></td></tr>)}</tbody></table></div>
   <div className="toolbar-row end"><button className="primary" disabled={dis} onClick={()=>save('regimes',regimes)}>Guardar formas de trabajar</button></div></section>
  <section className="panel"><h2>Demanda, ausentismo, rueda ABC y lote</h2>
   <div className="bom-form-grid">
    <label>Variación de la demanda ±%<input type="number" value={variation} onChange={e=>setVariation(Number(e.target.value))}/></label>
    <label>Ausentismo mínimo %<input type="number" value={abs.min} onChange={e=>setAbs({...abs,min:Number(e.target.value)})}/></label>
    <label>Ausentismo máximo %<input type="number" value={abs.max} onChange={e=>setAbs({...abs,max:Number(e.target.value)})}/></label>
    <label>Corte A (volumen acumulado)<input type="number" step="0.05" value={wheel.a} onChange={e=>setWheel({...wheel,a:Number(e.target.value)})}/></label>
    <label>Corte B (volumen acumulado)<input type="number" step="0.05" value={wheel.b} onChange={e=>setWheel({...wheel,b:Number(e.target.value)})}/></label>
    <label>Lote por defecto<input type="number" value={lot.default} onChange={e=>setLot({...lot,default:Number(e.target.value)})}/></label>
    <label className="inline-check"><input type="checkbox" checked={lot.learn} onChange={e=>setLot({...lot,learn:e.target.checked})}/> Usar el lote aprendido de los programas</label></div>
   <div className="toolbar-row end"><button disabled={dis} onClick={()=>save('demand_variation',{pct:variation})}>Guardar variación</button><button disabled={dis} onClick={()=>save('absenteeism',abs)}>Guardar ausentismo</button><button disabled={dis} onClick={()=>save('wheel',wheel)}>Guardar rueda ABC</button><button disabled={dis} onClick={()=>save('lot',lot)}>Guardar lote</button></div></section>
  <section className="panel"><h2>Áreas en el modelo</h2><p>Las áreas que limitan la capacidad se marcan en Restricciones → Personal y asistencia ("limita capacidad"). Las horas de cada código salen de su hoja de ruta y de las de sus componentes.</p>
   <div className="table-scroll"><table><thead><tr><th>Área</th><th className="number">Personal por turno</th><th className="number">Ausentismo usado</th><th className="number">Valor hora</th><th className="number">Rendimiento aprendido</th><th>En el modelo</th></tr></thead>
    <tbody>{props.areas.map(a=><tr key={a.key}><td>{a.name}</td><td className="number">{s.shifts.filter(x=>x.active).map(x=>x.headcount?.[a.key]??a.headcount).join(' + ')}</td><td className="number">{n1.format(a.absenteeismPct)} %</td><td className="number">{usd.format(a.hourlyWage)}</td><td className="number">{n2.format(a.efficiency)}</td><td>{a.inModel?'Sí':'No'}</td></tr>)}</tbody></table></div></section>
  <section className="panel"><h2>Datos de los modelos</h2><p>Los códigos sin hoja de ruta usan el tiempo promedio de su tipo y medida; los que no tienen árbol BOM o lista SAP no pueden explotar materiales.</p>
   <div className="metrics compact"><div><span>Con hoja de ruta</span><strong>{props.products.filter(p=>p.hoursSource==='RUTA').length}</strong><small>de {props.products.length}</small></div><div><span>Tiempo estimado</span><strong>{props.products.filter(p=>p.hoursSource!=='RUTA').length}</strong><small>{props.products.filter(p=>p.hoursSource!=='RUTA').map(p=>p.code).slice(0,6).join(', ')}</small></div>
    <div><span>Con árbol BOM</span><strong>{props.products.filter(p=>p.hasTree).length}</strong><small>de {props.products.length}</small></div><div><span>Con lista SAP</span><strong>{props.products.filter(p=>p.hasSap).length}</strong><small>sin ninguna: {props.products.filter(p=>!p.hasSap&&!p.hasTree).map(p=>p.code).join(', ')||'ninguno'}</small></div></div></section>
 </>;
}
