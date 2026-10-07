// Plan Maestro de Producción (MPS): modelo de programación lineal entera que minimiza el costo de horas extra.
// Lógica pura (sin base de datos). El solver es HiGHS (paquete npm "highs"); aquí se arma el modelo en formato LP
// y se interpreta la solución. La llave de todo es el código SAP del colchón.

export type MpsArea={
 key:string;name:string;
 headcount:number;          // personal base del área
 absenteeismPct:number;     // ausentismo esperado (%), p. ej. 3
 hourlyWage:number;         // valor hora ordinaria (USD) = sueldo / horas del mes
 efficiency:number;         // rendimiento real aprendido (1 = tiempo estándar)
 inModel:boolean;           // si el área limita la capacidad en el plan
};
export type MpsProduct={
 code:string;description:string;mattressType:string;panelType:string;size:number|null;
 monthlyDemand:number;
 hours:Record<string,number>;          // horas estándar por unidad en cada área (clave de área)
 hoursSource:'RUTA'|'ESTIMADO'|'SIN_DATO';
 unitCost:number|null;                 // costo de producción (USD)
 stock:number;                         // inventario inicial de producto terminado
 lot:number;                           // múltiplo de lote (aprendido del programador)
 hasEngineeringBom:boolean;hasSapList:boolean;
};
export type MpsGroup={key:string;name:string;maxPerDay:number;codes:string[];areaKey:string};
export type MpsDay={date:string;weekday:number;ordinaryHours:number;working:boolean;note?:string|null};
export type LaborPolicy={
 baseSalary:number;            // sueldo básico mensual (USD)
 monthlyHours:number;          // horas del mes para calcular el valor hora (Ecuador: 240)
 overtimeSurchargePct:number;  // recargo horas suplementarias (Ecuador: 50 %)
 extraordinarySurchargePct:number; // recargo sábados, domingos y feriados (Ecuador: 100 %)
 maxOvertimeDay:number;        // máximo de horas suplementarias por persona y día (Ecuador: 4)
 maxOvertimeWeek:number;       // máximo por persona y semana (Ecuador: 12)
 saturdayEnabled:boolean;      // la política permite trabajar sábados
 saturdayMaxHours:number;      // horas máximas por persona en sábado
};
/** Turno de trabajo. Cada área trabaja en todos los turnos activos; el de la noche rinde menos (productividad < 100 %). */
export type MpsShift={
 key:string;name:string;
 productivityPct:number;            // rendimiento del turno frente al de día (noche: 85 %)
 ordinaryHours:number|null;         // horas ordinarias del turno (vacío = las del calendario)
 referenceHours:number|null;        // horas netas de la jornada del turno para el "máximo por día" y el aprendizaje (vacío = la general)
 nightSurchargePct:number;          // recargo nocturno sobre el valor hora (Ecuador: 25 % entre 19:00 y 06:00)
 saturday:boolean;                  // el turno puede trabajar sábado
 active:boolean;
 headcount:Record<string,number|null>; // personas por área en este turno (vacío = personal base del área)
};
export const DEFAULT_SHIFTS:MpsShift[]=[
 {key:'DIA',name:'Turno día',productivityPct:100,ordinaryHours:null,referenceHours:null,nightSurchargePct:0,saturday:true,active:true,headcount:{}},
 {key:'NOCHE',name:'Turno noche',productivityPct:85,ordinaryHours:null,referenceHours:null,nightSurchargePct:25,saturday:false,active:true,headcount:{}}];
/** Un solo turno de día: equivale al modelo sin turnos. */
export const SINGLE_SHIFT:MpsShift[]=[DEFAULT_SHIFTS[0]];
export type Regime={key:'NORMAL'|'PRESIONADO'|'MAXIMO';label:string;efficiencyFactor:number;forcingPct:number;saturday:boolean;overtime:boolean};
export type MpsCosts={holdingPctMonthly:number;backlogPenalty:number;unmetPenalty:number;forcingPenalty:number};
export type SpecialOrder={code:string;date:string;quantity:number};
export type MpsInput={
 month:string;days:MpsDay[];areas:MpsArea[];products:MpsProduct[];groups:MpsGroup[];
 policy:LaborPolicy;regime:Regime;costs:MpsCosts;referenceHours:number;
 demandFactor:number;          // 1 = demanda base; 0.9 baja; 1.1 alta
 demandOverride?:Record<string,number>; // demanda mensual por código (pronóstico o Monte Carlo)
 absenteeismOverride?:Record<string,number>;
 shifts?:MpsShift[];           // turnos (por defecto uno solo de día)
 specialOrders:SpecialOrder[];useInitialStock:boolean;integer:boolean;
 consolidate?:boolean;
 wheel?:{a:number;b:number};   // cortes ABC de la rueda de producción (participación acumulada del volumen)
};

export const DEFAULT_POLICY:LaborPolicy={baseSalary:482,monthlyHours:240,overtimeSurchargePct:50,extraordinarySurchargePct:100,maxOvertimeDay:4,maxOvertimeWeek:12,saturdayEnabled:true,saturdayMaxHours:8};
export const DEFAULT_COSTS:MpsCosts={holdingPctMonthly:1,backlogPenalty:40,unmetPenalty:200,forcingPenalty:8};
export const DEFAULT_REGIMES:Regime[]=[
 {key:'NORMAL',label:'Normal',efficiencyFactor:1,forcingPct:0,saturday:false,overtime:true},
 {key:'PRESIONADO',label:'Presionado',efficiencyFactor:1.1,forcingPct:10,saturday:true,overtime:true},
 {key:'MAXIMO',label:'Esfuerzo máximo',efficiencyFactor:1.2,forcingPct:20,saturday:true,overtime:true}];
export const DEMAND_SCENARIOS=[{key:'BAJA',label:'Demanda baja',factor:0.9},{key:'BASE',label:'Demanda base',factor:1},{key:'ALTA',label:'Demanda alta',factor:1.1}] as const;

/** Semana ISO (lunes) a la que pertenece una fecha. */
export const weekStart=(date:string)=>{const d=new Date(date+'T12:00:00Z');const wd=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-wd+1);return d.toISOString().slice(0,10);};
export const overtimeRate=(p:LaborPolicy,wage:number)=>wage*(1+p.overtimeSurchargePct/100);
export const extraordinaryRate=(p:LaborPolicy,wage:number)=>wage*(1+p.extraordinarySurchargePct/100);

type Index={products:MpsProduct[];areas:MpsArea[];groups:MpsGroup[];days:(MpsDay&{saturday:boolean;regular:number;w:number})[];weeks:string[];demand:number[][];present:number[];eff:number[];abc:('A'|'B'|'C')[];
 shifts:MpsShift[];
 crew:number[][];        // personas presentes por área y turno
 factor:number[];        // productividad de cada turno (1 = día)
 shiftHours:number[][];  // horas ordinarias de cada turno por día [turno][día]
 groupWeight:number[][]; // peso de cada turno para el "máximo por día" de un grupo [área][turno]
};

/** Prepara índices: días programables, semanas, demanda por semana y personas presentes por área y turno. */
export function prepare(input:MpsInput):Index{
 const shifts=(input.shifts?.length?input.shifts:SINGLE_SHIFT).filter(s=>s.active!==false);
 const areas=input.areas.filter(a=>a.inModel&&shifts.some(s=>(s.headcount?.[a.key]??a.headcount)>0));
 const satOk=input.policy.saturdayEnabled&&input.regime.saturday&&input.policy.saturdayMaxHours>0&&shifts.some(s=>s.saturday);
 const days=input.days.filter(d=>d.date.startsWith(input.month)).map(d=>({...d,saturday:d.weekday===6&&!d.working,regular:d.working?d.ordinaryHours:0}))
  .filter(d=>(d.working&&d.ordinaryHours>0)||(d.saturday&&satOk));
 const weeks=[...new Set(days.map(d=>weekStart(d.date)))].sort();
 const dd=days.map(d=>({...d,w:weeks.indexOf(weekStart(d.date))}));
 const workingByWeek=weeks.map((_,w)=>dd.filter(d=>d.w===w&&d.working).length);
 const totalWorking=workingByWeek.reduce((s,n)=>s+n,0)||1;
 const products=input.products.filter(p=>(input.demandOverride?.[p.code]??p.monthlyDemand)>0||input.specialOrders.some(o=>o.code===p.code));
 const monthly=products.map(p=>(input.demandOverride?.[p.code]??p.monthlyDemand)*input.demandFactor);
 // Rueda de producción ABC: los modelos A (80 % del volumen) se reparten todas las semanas, los B (siguiente 15 %)
 // cada dos semanas y los C (resto) en una sola semana del mes, asignada para equilibrar la carga.
 const wheel=input.wheel??{a:0.8,b:0.95};const total=monthly.reduce((a,b)=>a+b,0)||1;
 const order=products.map((_,i)=>i).sort((a,b)=>monthly[b]-monthly[a]);let acc=0;const cls:('A'|'B'|'C')[]=products.map(()=>'A');
 for(const i of order){acc+=monthly[i];cls[i]=acc/total<=wheel.a||acc===monthly[i]?'A':acc/total<=wheel.b?'B':'C';}
 const usable=weeks.map((_,w)=>w).filter(w=>workingByWeek[w]>0);const load=weeks.map(()=>0);
 const hoursOf=(p:MpsProduct)=>Object.values(p.hours).reduce((a,b)=>a+b,0)||1;
 const pick=(n:number,i:number)=>{const ws:number[]=[];for(let r=0;r<n;r++){const w=usable.filter(w=>!ws.includes(w)).sort((x,y)=>load[x]/workingByWeek[x]-load[y]/workingByWeek[y])[0];if(w===undefined)break;ws.push(w);}
  const share=ws.reduce((s,w)=>s+workingByWeek[w],0)||1;for(const w of ws)load[w]+=monthly[i]*hoursOf(products[i])*workingByWeek[w]/share;return {ws,share};};
 const slots=products.map(()=>null as null|{ws:number[];share:number});
 for(const i of order)if(cls[i]!=='A')slots[i]=pick(cls[i]==='B'?Math.max(1,Math.ceil(usable.length/2)):1,i);
 const demand=products.map((p,i)=>{const m=monthly[i];const sl=slots[i];
  const row=weeks.map((_,w)=>sl?(sl.ws.includes(w)?m*workingByWeek[w]/sl.share:0):m*workingByWeek[w]/totalWorking);
  for(const o of input.specialOrders.filter(o=>o.code===p.code&&o.date.startsWith(input.month))){const w=weeks.indexOf(weekStart(o.date));if(w>=0)row[w]+=o.quantity;}
  return row;});
 const crew=areas.map(a=>{const alpha=(input.absenteeismOverride?.[a.key]??a.absenteeismPct)/100;return shifts.map(s=>Math.max(0,s.headcount?.[a.key]??a.headcount)*(1-alpha));});
 const present=crew.map(r=>r.reduce((x,y)=>x+y,0));
 const eff=areas.map(a=>a.efficiency*input.regime.efficiencyFactor);
 const factor=shifts.map(s=>s.productivityPct/100);
 const shiftHours=shifts.map(s=>dd.map(d=>d.working?(s.ordinaryHours??d.regular):0));
 // El "máximo por día" de un grupo vale para un día completo de todos los turnos a sus horas de referencia;
 // cada turno aporta según su productividad y su personal. Con un solo turno el peso es 1 / horas de referencia.
 const ref=input.referenceHours||11;
 const groupWeight=crew.map(r=>{const w=shifts.map((s,si)=>factor[si]*(r[si]>0?r[si]:0));const den=w.reduce((acc,x,si)=>acc+x*(shifts[si].referenceHours??ref),0);
  if(den>0)return w.map(x=>x/den);const d2=shifts.reduce((acc,s,si)=>acc+factor[si]*(s.referenceHours??ref),0)||1;return factor.map(f=>f/d2);});
 return {products,areas,groups:input.groups.filter(g=>g.maxPerDay>0),days:dd,weeks,demand,present,eff,abc:cls,shifts,crew,factor,shiftHours,groupWeight};
}

const f=(n:number)=>{const r=Math.round(n*1e6)/1e6;return Object.is(r,-0)?'0':String(r);};
const term=(c:number,v:string)=>c===0?'':`${c<0?'-':'+'} ${f(Math.abs(c))} ${v}`;

/** Arma el modelo en formato LP (CPLEX) que lee HiGHS. Ver el informe para la explicación de cada bloque. */
export function buildLp(input:MpsInput,ix=prepare(input)){
 const {products:P,areas:A,groups:G,days:T,weeks:W,demand:D,eff,shifts:S,crew,factor,shiftHours:H,groupWeight}=ix;
 const pol=input.policy;const reg=input.regime;
 const k=(i:number,t:number)=>`k_${i}_${t}`;const s=(a:number,si:number,t:number)=>`s_${a}_${si}_${t}`;const z=(a:number,si:number,t:number)=>`z_${a}_${si}_${t}`;
 const inv=(i:number,w:number)=>`inv_${i}_${w}`;const bk=(i:number,w:number)=>`b_${i}_${w}`;const u=(g:number,t:number)=>`u_${g}_${t}`;
 const hasS=(ai:number,si:number,t:number)=>T[t].working&&reg.overtime&&crew[ai][si]>0;
 const hasZ=(ai:number,si:number,t:number)=>T[t].saturday&&S[si].saturday&&crew[ai][si]>0;
 const obj:string[]=[];const rows:string[]=[];const bounds:string[]=[];const ints:string[]=[];let nVars=0;
 // Función objetivo: horas extra y de sábado de cada turno (el turno de noche lleva además su recargo nocturno)
 A.forEach((a,ai)=>S.forEach((sh,si)=>T.forEach((_,t)=>{const night=1+sh.nightSurchargePct/100;
  if(hasS(ai,si,t)){obj.push(term(overtimeRate(pol,a.hourlyWage)*night*crew[ai][si],s(ai,si,t)));nVars++;}
  if(hasZ(ai,si,t)){obj.push(term(extraordinaryRate(pol,a.hourlyWage)*night*crew[ai][si],z(ai,si,t)));nVars++;}})));
 P.forEach((p,i)=>W.forEach((_,w)=>{
  const h=(p.unitCost??0)*input.costs.holdingPctMonthly/100*12/52;
  obj.push(term(Math.max(h,1e-4),inv(i,w)));
  obj.push(term(w===W.length-1?input.costs.unmetPenalty:input.costs.backlogPenalty,bk(i,w)));}));
 G.forEach((_,g)=>T.forEach((_,t)=>{if(reg.forcingPct>0)obj.push(term(input.costs.forcingPenalty,u(g,t)));}));
 // (1) Balance acumulado por semana: producción − inventario + atraso = demanda acumulada − inventario inicial
 P.forEach((p,i)=>W.forEach((_,w)=>{
  const cum=D[i].slice(0,w+1).reduce((a,b)=>a+b,0);const i0=input.useInitialStock?Math.max(0,p.stock):0;
  const lhs=T.map((d,t)=>d.w<=w?term(p.lot,k(i,t)):'').join(' ');
  rows.push(` bal_${i}_${w}: ${lhs} - 1 ${inv(i,w)} + 1 ${bk(i,w)} = ${f(cum-i0)}`);}));
 // (2) Capacidad por área en horas: suma de los turnos, cada uno con su personal presente y su productividad
 A.forEach((a,ai)=>T.forEach((d,t)=>{
  const lhs=P.map((p,i)=>term((p.hours[a.key]??0)*p.lot,k(i,t))).join(' ');if(!lhs.trim())return;
  const cap=S.map((_,si)=>eff[ai]*factor[si]*crew[ai][si]);
  const extra=S.map((_,si)=>`${hasS(ai,si,t)?' '+term(-cap[si],s(ai,si,t)):''}${hasZ(ai,si,t)?' '+term(-cap[si],z(ai,si,t)):''}`).join('');
  rows.push(` cap_${ai}_${t}: ${lhs}${extra} <= ${f(S.reduce((acc,_,si)=>acc+cap[si]*H[si][t],0))}`);}));
 // (3) Límites legales de horas extra por persona, en cada turno
 A.forEach((_,ai)=>S.forEach((_,si)=>{
  T.forEach((d,t)=>{if(hasS(ai,si,t))bounds.push(` 0 <= ${s(ai,si,t)} <= ${f(pol.maxOvertimeDay)}`);if(hasZ(ai,si,t))bounds.push(` 0 <= ${z(ai,si,t)} <= ${f(pol.saturdayMaxHours)}`);});
  W.forEach((_,w)=>{const vs=T.map((d,t)=>d.w===w&&hasS(ai,si,t)?`+ 1 ${s(ai,si,t)}`:'').filter(Boolean);if(vs.length)rows.push(` otw_${ai}_${si}_${w}: ${vs.join(' ')} <= ${f(pol.maxOvertimeWeek)}`);});}));
 // (4) Máximo diario por grupo (escalado a las horas trabajadas de los turnos del área que lo limita) con forzado acotado
 G.forEach((g,gi)=>{const ai=Math.max(0,A.findIndex(a=>a.key===g.areaKey));
  const members=P.map((p,i)=>g.codes.includes(p.code)?i:-1).filter(i=>i>=0);if(!members.length)return;
  T.forEach((d,t)=>{
   const lhs=members.map(i=>term(P[i].lot,k(i,t))).join(' ');
   const wgt=A.length?groupWeight[ai]:S.map(()=>1/(input.referenceHours||11));
   const extra=A.length?S.map((_,si)=>`${hasS(ai,si,t)?' '+term(-g.maxPerDay*wgt[si],s(ai,si,t)):''}${hasZ(ai,si,t)?' '+term(-g.maxPerDay*wgt[si],z(ai,si,t)):''}`).join(''):'';
   rows.push(` grp_${gi}_${t}: ${lhs}${extra}${reg.forcingPct>0?' - 1 '+u(gi,t):''} <= ${f(g.maxPerDay*S.reduce((acc,_,si)=>acc+wgt[si]*H[si][t],0))}`);
   if(reg.forcingPct>0){bounds.push(` 0 <= ${u(gi,t)} <= ${f(g.maxPerDay*reg.forcingPct/100)}`);nVars++;}});});
 // (5) Dominio: cantidades enteras en múltiplos de lote
 P.forEach((_,i)=>T.forEach((_,t)=>{bounds.push(` ${k(i,t)} >= 0`);if(input.integer)ints.push(k(i,t));}));
 const lp=['Minimize',' obj: '+(obj.filter(Boolean).join(' ')||'0 '+k(0,0)),'Subject To',...rows,'Bounds',...bounds,...(ints.length?['General',' '+ints.join(' ')]:[]),'End'].join('\n');
 return {lp,ix,stats:{variables:P.length*T.length+nVars+P.length*W.length*2,integers:ints.length,constraints:rows.length}};
}

export type Classification='OPTIMO'|'CON_LAS_JUSTAS'|'NO_ALCANZA';
export type MpsResult={
 status:string;objective:number;solveSeconds:number;classification:Classification;
 days:{date:string;weekday:number;saturday:boolean;total:number}[];weeks:string[];
 plan:{code:string;description:string;mattressType:string;panelType:string;size:number|null;lot:number;abc:'A'|'B'|'C';weeklyDemand:number[];demand:number;produced:number;unmet:number;daily:number[];weekly:number[];hoursSource:string}[];
 areas:{key:string;name:string;present:number;efficiency:number;overtimeUse:number;saturdayUse:number;daily:{required:number;regular:number;overtimePerPerson:number;overtimeHours:number;saturdayHours:number;utilization:number}[];shifts:{key:string;name:string;present:number;productivity:number;overtimeHours:number;saturdayHours:number;overtimeCost:number;saturdayCost:number}[];overtimeHours:number;saturdayHours:number;overtimeCost:number;saturdayCost:number;requiredHours:number;regularHours:number}[];
 groups:{key:string;name:string;maxPerDay:number;daily:{planned:number;capacity:number;forced:number}[];forced:number;forcedDays:number}[];
 kpis:{demand:number;produced:number;unmet:number;serviceLevel:number;overtimeHours:number;saturdayHours:number;laborCost:number;holdingCost:number;forcedUnits:number;forcedDays:number;extraPeopleEquivalent:number;modelsPerDay:number};
 stats:{variables:number;integers:number;constraints:number};
};

/** Horas estándar que entrega un área en un día: suma de turnos de η·productividad·presentes·(ordinarias + extra + sábado). */
const areaAvail=(ix:Index,ai:number,t:number,v:(n:string)=>number)=>ix.shifts.reduce((acc,_,si)=>acc+ix.eff[ai]*ix.factor[si]*ix.crew[ai][si]*(ix.shiftHours[si][t]+v(`s_${ai}_${si}_${t}`)+v(`z_${ai}_${si}_${t}`)),0);
/** Unidades que admite un grupo en un día según las horas trabajadas en cada turno del área que lo limita (sin el forzado). */
const groupAvail=(ix:Index,g:MpsGroup,ai:number,t:number,v:(n:string)=>number,ref:number)=>{const has=ix.areas.length>0;const w=has?ix.groupWeight[ai]:ix.shifts.map(()=>1/ref);
 return g.maxPerDay*ix.shifts.reduce((acc,_,si)=>acc+w[si]*(ix.shiftHours[si][t]+(has?v(`s_${ai}_${si}_${t}`)+v(`z_${ai}_${si}_${t}`):0)),0);};

type HighsSolution={Status:string;ObjectiveValue:number;Columns:Record<string,{Primal:number}>};
/** Interpreta la solución de HiGHS y calcula indicadores y la clasificación del escenario. */
export function readSolution(input:MpsInput,ix:Index,sol:HighsSolution,stats:MpsResult['stats'],seconds:number):MpsResult{
 const {products:P,areas:A,groups:G,days:T,weeks:W,demand:D,present,eff}=ix;const v=(n:string)=>sol.Columns?.[n]?.Primal??0;const ref=input.referenceHours||11;
 // Modo exacto: k entero. Modo rápido (relajación lineal): se redondea k al lote más cercano.
 // El redondeo es acumulado: el total de cada código queda a menos de un lote del óptimo continuo.
 const plan=P.map((p,i)=>{let cum=0,prev=0;const daily=T.map((_,t)=>{cum+=Math.max(0,v(`k_${i}_${t}`));const r=Math.round(cum+1e-6);const q=(r-prev)*p.lot;prev=r;return q;});const weekly=W.map((_,w)=>T.reduce((s,d,t)=>d.w===w?s+daily[t]:s,0));
  const demand=D[i].reduce((a,b)=>a+b,0);const produced=daily.reduce((a,b)=>a+b,0);const i0=input.useInitialStock?Math.max(0,p.stock):0;const unmet=Math.max(0,demand-i0-produced);
  return {code:p.code,description:p.description,mattressType:p.mattressType,panelType:p.panelType,size:p.size,lot:p.lot,abc:ix.abc[i],demand,weeklyDemand:D[i],produced,unmet,daily,weekly,hoursSource:p.hoursSource};});
 if(input.consolidate!==false)consolidate(input,ix,plan,v);
 const {shifts:S,crew}=ix;const sv=(ai:number,si:number,t:number)=>v(`s_${ai}_${si}_${t}`),zv=(ai:number,si:number,t:number)=>v(`z_${ai}_${si}_${t}`);
 const areas=A.map((a,ai)=>{const daily=T.map((d,t)=>{const required=P.reduce((s,p,i)=>s+(p.hours[a.key]??0)*plan[i].daily[t],0);
   const overtimeHours=S.reduce((s,_,si)=>s+sv(ai,si,t)*crew[ai][si],0),saturdayHours=S.reduce((s,_,si)=>s+zv(ai,si,t)*crew[ai][si],0);
   const avail=areaAvail(ix,ai,t,v);return {required,regular:S.reduce((s,_,si)=>s+crew[ai][si]*ix.shiftHours[si][t],0),overtimePerPerson:present[ai]>0?overtimeHours/present[ai]:0,overtimeHours,saturdayHours,utilization:avail>0?required/avail:0};});
  // Por turno: horas extra, de sábado y su costo (el de noche con recargo nocturno).
  const shifts=S.map((sh,si)=>{const night=1+sh.nightSurchargePct/100;const ot=T.reduce((s,_,t)=>s+sv(ai,si,t)*crew[ai][si],0),sat=T.reduce((s,_,t)=>s+zv(ai,si,t)*crew[ai][si],0);
   return {key:sh.key,name:sh.name,present:crew[ai][si],productivity:ix.factor[si],overtimeHours:ot,saturdayHours:sat,overtimeCost:ot*overtimeRate(input.policy,a.hourlyWage)*night,saturdayCost:sat*extraordinaryRate(input.policy,a.hourlyWage)*night};});
  const overtimeHours=daily.reduce((s,d)=>s+d.overtimeHours,0),saturdayHours=daily.reduce((s,d)=>s+d.saturdayHours,0);
  // Horas extra posibles en el mes (tope diario y semanal por persona) para ver qué área es el cuello de botella.
  const otPerPerson=W.reduce((s,_,w)=>s+Math.min(input.policy.maxOvertimeWeek,T.filter(d=>d.w===w&&d.working).length*input.policy.maxOvertimeDay),0);
  const otMax=input.regime.overtime?otPerPerson*present[ai]:0;
  const satMax=T.filter(d=>d.saturday).length*input.policy.saturdayMaxHours*S.reduce((s,sh,si)=>s+(sh.saturday?crew[ai][si]:0),0);
  return {key:a.key,name:a.name,present:present[ai],efficiency:eff[ai],daily,shifts,overtimeHours,overtimeUse:otMax>0?overtimeHours/otMax:0,saturdayUse:satMax>0?saturdayHours/satMax:0,saturdayHours,overtimeCost:shifts.reduce((s,x)=>s+x.overtimeCost,0),saturdayCost:shifts.reduce((s,x)=>s+x.saturdayCost,0),requiredHours:daily.reduce((s,d)=>s+d.required,0),regularHours:daily.reduce((s,d)=>s+d.regular,0)};});
 const groups=G.map((g,gi)=>{const ai=Math.max(0,A.findIndex(a=>a.key===g.areaKey));const daily=T.map((d,t)=>{const planned=P.reduce((s,p,i)=>g.codes.includes(p.code)?s+plan[i].daily[t]:s,0);
   const capacity=groupAvail(ix,g,ai,t,v,ref);return {planned,capacity,forced:Math.max(0,v(`u_${gi}_${t}`))};});
  return {key:g.key,name:g.name,maxPerDay:g.maxPerDay,daily,forced:daily.reduce((s,d)=>s+d.forced,0),forcedDays:daily.filter(d=>d.forced>0.5).length};});
 const demand=plan.reduce((s,p)=>s+p.demand,0),produced=plan.reduce((s,p)=>s+p.produced,0),unmet=plan.reduce((s,p)=>s+p.unmet,0);
 const overtimeHours=areas.reduce((s,a)=>s+a.overtimeHours,0),saturdayHours=areas.reduce((s,a)=>s+a.saturdayHours,0);
 const holdingCost=P.reduce((s,p,i)=>s+W.reduce((x,_,w)=>x+v(`inv_${i}_${w}`)*(p.unitCost??0)*input.costs.holdingPctMonthly/100*12/52,0),0);
 const forcedUnits=groups.reduce((s,g)=>s+g.forced,0);const forcedDays=new Set(groups.flatMap(g=>g.daily.map((d,t)=>d.forced>0.5?t:-1).filter(t=>t>=0))).size;
 const ordinaryPerPerson=T.reduce((s,d)=>s+d.regular,0)||1;
 const regularTotal=areas.reduce((s,a)=>s+a.regularHours,0)||1;
 const kpis={demand,produced,unmet,serviceLevel:demand>0?1-unmet/demand:1,overtimeHours,saturdayHours,laborCost:areas.reduce((s,a)=>s+a.overtimeCost+a.saturdayCost,0),holdingCost,forcedUnits,forcedDays,
  extraPeopleEquivalent:(overtimeHours+saturdayHours)/ordinaryPerPerson,modelsPerDay:plan.reduce((s,p)=>s+p.daily.filter(q=>q>0).length,0)/(T.filter((_,t)=>plan.some(p=>p.daily[t]>0)).length||1)};
 const classification:Classification=unmet>Math.max(1,0.005*demand)?'NO_ALCANZA':(forcedUnits<0.5&&saturdayHours<0.5&&overtimeHours<=0.05*regularTotal)?'OPTIMO':'CON_LAS_JUSTAS';
 return {status:sol.Status,objective:sol.ObjectiveValue,solveSeconds:seconds,classification,days:T.map((d,t)=>({date:d.date,weekday:d.weekday,saturday:d.saturday,total:plan.reduce((s,p)=>s+p.daily[t],0)})),weeks:W,plan,areas,groups,kpis,stats};
}

/**
 * Secuenciación por lotes dentro de cada semana. El modelo decide cuánto producir por semana y las horas extra de cada día;
 * luego cada modelo se asigna a la menor cantidad de días posible (como lo hace el programador), sin pasar la capacidad
 * de cada área ni el máximo de cada grupo que dejó el modelo para ese día. Los totales semanales no cambian.
 */
function consolidate(input:MpsInput,ix:Index,plan:{daily:number[];weekly:number[]}[],v:(n:string)=>number){
 const {products:P,areas:A,groups:G,days:T,weeks:W}=ix;const ref=input.referenceHours||11;
 const areaCap=A.map((_,ai)=>T.map((_,t)=>areaAvail(ix,ai,t,v)));
 const groupCap=G.map((g,gi)=>{const ai=Math.max(0,A.findIndex(a=>a.key===g.areaKey));return T.map((_,t)=>groupAvail(ix,g,ai,t,v,ref)+Math.max(0,v(`u_${gi}_${t}`)));});
 const member=G.map(g=>new Set(g.codes));
 W.forEach((_,w)=>{
  const days=T.map((d,t)=>d.w===w?t:-1).filter(t=>t>=0);if(days.length<2)return;
  const aSlack=A.map((_,ai)=>days.map(t=>areaCap[ai][t]));const gSlack=G.map((_,gi)=>days.map(t=>groupCap[gi][t]));
  const order=P.map((_,i)=>i).filter(i=>plan[i].weekly[w]>0).sort((a,b)=>plan[b].weekly[w]-plan[a].weekly[w]);
  const fit=(i:number,j:number)=>{let m=Infinity;A.forEach((a,ai)=>{const h=P[i].hours[a.key]??0;if(h>0)m=Math.min(m,aSlack[ai][j]/h);});G.forEach((_,gi)=>{if(member[gi].has(P[i].code))m=Math.min(m,gSlack[gi][j]);});return m;};
  const take=(i:number,j:number,q:number)=>{A.forEach((a,ai)=>aSlack[ai][j]-=(P[i].hours[a.key]??0)*q);G.forEach((_,gi)=>{if(member[gi].has(P[i].code))gSlack[gi][j]-=q;});};
  const next=days.map(()=>P.map(()=>0));
  for(const i of order){let q=plan[i].weekly[w];const lot=P[i].lot;
   while(q>0){
    // Preferencia: un día donde entre todo lo que falta; luego un día donde ya se hace este modelo y aún cabe un lote; luego el de más holgura.
    const used=(j:number,f:number)=>next[j][i]>0&&f>=lot?1:0;
    const cand=days.map((_,j)=>({j,f:fit(i,j)})).sort((a,b)=>(b.f>=q?1:0)-(a.f>=q?1:0)||used(b.j,b.f)-used(a.j,a.f)||b.f-a.f);
    const {j,f}=cand[0];let amount=f>=q?q:Math.floor(Math.max(0,f)/lot)*lot;
    if(amount<=0)amount=Math.min(q,lot);                            // sin holgura en ningún día: un lote al día con más holgura
    take(i,j,amount);next[j][i]+=amount;q-=amount;}}
  days.forEach((t,j)=>P.forEach((_,i)=>{plan[i].daily[t]=next[j][i];}));});
}

type Highs={solve:(lp:string,options?:Record<string,unknown>)=>HighsSolution};
/** Resuelve un escenario completo con HiGHS. */
export function solveMps(highs:Highs,input:MpsInput,options:{timeLimit?:number;gap?:number}={}):MpsResult{
 const {lp,ix,stats}=buildLp(input);const t0=Date.now();
 const sol=highs.solve(lp,{time_limit:options.timeLimit??60,mip_rel_gap:options.gap??0.01,presolve:'on',output_flag:false});
 if(!['Optimal','Time limit reached','Target for objective reached','Solution limit reached'].includes(sol.Status)||!sol.Columns)throw new Error(`El solver no encontró solución (${sol.Status}).`);
 return readSolution(input,ix,sol,stats,(Date.now()-t0)/1000);
}

export const CLASS_LABEL:Record<Classification,string>={OPTIMO:'Óptimo',CON_LAS_JUSTAS:'Con las justas',NO_ALCANZA:'No alcanza'};

export type MonteCarloSummary={runs:number;meetProbability:number;classes:Record<Classification,number>;
 serviceLevel:{mean:number;p10:number;p90:number};overtimeHours:{mean:number;p10:number;p90:number};saturdayHours:{mean:number;p10:number;p90:number};laborCost:{mean:number;p10:number;p90:number};unmet:{mean:number;p10:number;p90:number};
 samples:{demand:number;serviceLevel:number;overtimeHours:number;saturdayHours:number;laborCost:number;classification:Classification}[]};
const pct=(xs:number[],q:number)=>{const s=[...xs].sort((a,b)=>a-b);if(!s.length)return 0;const p=(s.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);return s[lo]+(s[hi]-s[lo])*(p-lo);};
const stat=(xs:number[])=>({mean:xs.reduce((a,b)=>a+b,0)/(xs.length||1),p10:pct(xs,0.1),p90:pct(xs,0.9)});

/**
 * Simulación Monte Carlo: en cada corrida la demanda de cada código varía al azar dentro de ±variación
 * y el ausentismo de cada área entre el mínimo y el máximo. Se resuelve el modelo (relajación lineal) y se cuenta
 * en cuántas corridas se cumple la demanda.
 */
export function monteCarlo(highs:Highs,input:MpsInput,opts:{runs:number;variationPct:number;absenteeismMin:number;absenteeismMax:number;random:()=>number}):MonteCarloSummary{
 const samples:MonteCarloSummary['samples']=[];
 for(let r=0;r<opts.runs;r++){
  const demandOverride:Record<string,number>={};for(const p of input.products){const base=input.demandOverride?.[p.code]??p.monthlyDemand;demandOverride[p.code]=Math.max(0,base*(1+(opts.random()*2-1)*opts.variationPct/100));}
  const absenteeismOverride:Record<string,number>={};for(const a of input.areas)absenteeismOverride[a.key]=opts.absenteeismMin+(opts.absenteeismMax-opts.absenteeismMin)*opts.random();
  const res=solveMps(highs,{...input,demandOverride,absenteeismOverride,integer:false,consolidate:false},{timeLimit:20});
  samples.push({demand:res.kpis.demand,serviceLevel:res.kpis.serviceLevel,overtimeHours:res.kpis.overtimeHours,saturdayHours:res.kpis.saturdayHours,laborCost:res.kpis.laborCost,classification:res.classification});}
 const classes={OPTIMO:0,CON_LAS_JUSTAS:0,NO_ALCANZA:0} as Record<Classification,number>;for(const s of samples)classes[s.classification]++;
 return {runs:samples.length,meetProbability:samples.length?(classes.OPTIMO+classes.CON_LAS_JUSTAS)/samples.length:0,classes,
  serviceLevel:stat(samples.map(s=>s.serviceLevel)),overtimeHours:stat(samples.map(s=>s.overtimeHours)),saturdayHours:stat(samples.map(s=>s.saturdayHours)),laborCost:stat(samples.map(s=>s.laborCost)),unmet:stat(samples.map(s=>s.demand*(1-s.serviceLevel))),samples};
}
