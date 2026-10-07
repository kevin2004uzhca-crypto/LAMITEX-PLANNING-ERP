// Lógica pura de demanda, capacidad y entrenamiento (sin acceso a base de datos).
export type DemandItem={material_code:string;description:string;mattress_type:string;panel_type:string;size_cm:number|null;monthly_demand:number;active:boolean;notes?:string|null;updated_at?:string;last_source?:string};
export type PlanningCode={kind:'COLCHON'|'PANEL';code:string;name:string;active:boolean;sort:number};
export type Restriction={id:number;name:string;applies_to:'COLCHON'|'PANEL';codes:string[];sizes:number[]|null;max_per_day:number;active:boolean;notes:string|null;sort:number};
export type Area={id:number;name:string;headcount:number|null;default_attendance_pct:number;limits_capacity:boolean;active:boolean;notes:string|null;sort:number};
export type WeekDay={weekday:number;is_working:boolean;start_time:string;end_time:string;break_minutes:number;ordinary_hours:number};
export type WorkDayException=WeekDay&{day:string;note:string|null};
export type AttendanceMonth={month:string;area_id:number;attendance_pct:number};
export type AttendanceDay={day:string;area_id:number;attendance_pct:number;note:string|null};

export const WEEKDAYS=['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'] as const;
export const WEEKDAY_LABELS=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
export const DEMAND_COLUMNS=['Material','Descripción del material','TIPO DE COLCHON','TIPO DE PANEL','MEDIDA','PROMEDIO VENTA MENSUAL VOLUMEN'];

export const normalizeCode=(v:unknown)=>String(v??'').trim().toUpperCase();
const plain=(v:unknown)=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim().toUpperCase();

/** Convierte valores de celdas de ExcelJS (fórmulas, texto enriquecido) a valores simples. */
export function cellValue(v:unknown):string|number|null{
 if(v===null||v===undefined)return null;
 if(typeof v==='number'||typeof v==='string')return v;
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='object'){const o=v as any;if('result' in o)return cellValue(o.result);if(Array.isArray(o.richText))return o.richText.map((r:any)=>r.text).join('');if('text' in o)return cellValue(o.text);}
 return String(v);
}
const toNumber=(v:string|number|null)=>{if(v===null||v==='')return null;const n=typeof v==='number'?v:Number(String(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:NaN;};

export type DemandRow={material_code:string;description:string;mattress_type:string;panel_type:string;size_cm:number|null;monthly_demand:number;source_row:number};
/** Lee filas con las mismas columnas del Excel DEMANDAS.LAMITEX (A-F). Acepta encabezados repetidos y filas vacías. */
export function parseDemandRows(rows:(string|number|null)[][],codes:PlanningCode[]){
 const errors:string[]=[];const warnings:string[]=[];const out=new Map<string,DemandRow>();
 const header=rows.findIndex(r=>plain(r[0])==='MATERIAL');
 if(header<0)throw new Error('No se encontró la columna "Material". Usa las columnas: '+DEMAND_COLUMNS.join(' · '));
 const expected=DEMAND_COLUMNS.map(plain);const got=rows[header].slice(0,6).map(plain);
 if(expected.some((c,i)=>!got[i]?.startsWith(c.slice(0,12))))throw new Error('Las columnas no coinciden. Deben ser, en este orden: '+DEMAND_COLUMNS.join(' · '));
 const valid=(kind:string,code:string)=>codes.some(c=>c.kind===kind&&c.code===code);
 rows.forEach((r,i)=>{
  if(i<=header)return;const line=i+1;
  if(r.slice(0,6).every(v=>v===null||String(v).trim()===''))return;
  if(plain(r[0])==='MATERIAL')return;
  // Fila de totales (p. ej. =SUMA(F3:F245)): solo trae la columna de demanda.
  if(r.slice(0,5).every(v=>v===null||String(v).trim()==='')){warnings.push(`Fila ${line}: fila de totales ignorada.`);return;}
  const code=String(r[0]??'').trim();const description=String(r[1]??'').replace(/\s+/g,' ').trim();
  const mattress=normalizeCode(r[2]);const panel=normalizeCode(r[3])||'NP';const size=toNumber(r[4]);const demand=toNumber(r[5]);
  if(!code||/\s/.test(code)){errors.push(`Fila ${line}: código de material vacío o con espacios.`);return;}
  if(!description)errors.push(`Fila ${line} (${code}): falta la descripción.`);
  if(!mattress)errors.push(`Fila ${line} (${code}): falta el tipo de colchón.`);
  else if(!valid('COLCHON',mattress))errors.push(`Fila ${line} (${code}): tipo de colchón "${mattress}" no existe en el catálogo de letras.`);
  if(!valid('PANEL',panel))errors.push(`Fila ${line} (${code}): tipo de panel "${panel}" no existe en el catálogo de letras.`);
  if(Number.isNaN(size)||(size!==null&&size<=0))errors.push(`Fila ${line} (${code}): medida inválida.`);
  if(demand===null)warnings.push(`Fila ${line} (${code}): sin demanda; se registra como 0.`);
  else if(Number.isNaN(demand)||demand<0)errors.push(`Fila ${line} (${code}): demanda inválida.`);
  if(r[2]!==null&&String(r[2]).trim()!==mattress)warnings.push(`Fila ${line} (${code}): tipo "${String(r[2]).trim()}" se normalizó a "${mattress}".`);
  const row:DemandRow={material_code:code,description,mattress_type:mattress,panel_type:panel,size_cm:size===null||Number.isNaN(size)?null:size,monthly_demand:demand===null||Number.isNaN(demand)?0:demand,source_row:line};
  const prev=out.get(code);
  if(prev){const same=prev.description===row.description&&prev.mattress_type===row.mattress_type&&prev.panel_type===row.panel_type&&prev.size_cm===row.size_cm&&prev.monthly_demand===row.monthly_demand;
   if(same)warnings.push(`Fila ${line} (${code}): repetida e idéntica a la fila ${prev.source_row}; se toma una sola vez.`);
   else errors.push(`Fila ${line} (${code}): material repetido con datos distintos a la fila ${prev.source_row}.`);return;}
  out.set(code,row);
 });
 if(!out.size&&!errors.length)errors.push('El archivo no tiene filas de demanda.');
 return {rows:[...out.values()],errors,warnings};
}

export type DemandDiff={material_code:string;description:string;status:'NUEVO'|'CAMBIA'|'IGUAL';changes:string[]};
export function diffDemand(incoming:DemandRow[],current:DemandItem[]):DemandDiff[]{
 const map=new Map(current.map(c=>[c.material_code,c]));
 return incoming.map(r=>{const c=map.get(r.material_code);if(!c)return {material_code:r.material_code,description:r.description,status:'NUEVO',changes:[]};
  const changes:string[]=[];
  if(c.description!==r.description)changes.push('descripción');
  if(c.mattress_type!==r.mattress_type)changes.push(`tipo colchón ${c.mattress_type}→${r.mattress_type}`);
  if(c.panel_type!==r.panel_type)changes.push(`tipo panel ${c.panel_type}→${r.panel_type}`);
  if(Number(c.size_cm??0)!==Number(r.size_cm??0))changes.push(`medida ${c.size_cm??'—'}→${r.size_cm??'—'}`);
  if(Number(c.monthly_demand)!==r.monthly_demand)changes.push(`demanda ${Number(c.monthly_demand)}→${r.monthly_demand}`);
  if(!c.active)changes.push('se reactiva');
  return {material_code:r.material_code,description:r.description,status:changes.length?'CAMBIA':'IGUAL',changes};});
}

/** Un modelo consume la capacidad de una restricción si su letra (colchón o panel) y su medida coinciden. */
export function matchesRestriction(item:Pick<DemandItem,'mattress_type'|'panel_type'|'size_cm'>,r:Pick<Restriction,'applies_to'|'codes'|'sizes'>){
 const code=r.applies_to==='COLCHON'?item.mattress_type:item.panel_type;
 if(!r.codes.includes(code))return false;
 if(r.sizes&&r.sizes.length)return item.size_cm!==null&&r.sizes.map(Number).includes(Number(item.size_cm));
 return true;
}

const minutes=(t:string)=>{const [h,m]=t.split(':').map(Number);return h*60+(m||0);};
export function netHours(d:Pick<WeekDay,'is_working'|'start_time'|'end_time'|'break_minutes'>){
 if(!d.is_working)return 0;return Math.max(0,(minutes(d.end_time)-minutes(d.start_time)-d.break_minutes)/60);
}
export const isoWeekday=(date:string)=>{const d=new Date(date+'T12:00:00Z').getUTCDay();return d===0?7:d;};
export function monthDays(month:string){const [y,m]=month.split('-').map(Number);const n=new Date(Date.UTC(y,m,0)).getUTCDate();return Array.from({length:n},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);}

export type CalendarDay={day:string;weekday:number;is_working:boolean;hours:number;ordinary:number;overtime:number;exception:boolean;note:string|null;attendance:Record<number,number>;factor:number};
/** Arma el calendario del mes combinando semana tipo, excepciones por fecha y asistencia (mes y día). */
export function buildCalendar(month:string,week:WeekDay[],exceptions:WorkDayException[],areas:Area[],monthAttendance:AttendanceMonth[],dayAttendance:AttendanceDay[]):CalendarDay[]{
 const first=`${month}-01`;
 return monthDays(month).map(day=>{const wd=isoWeekday(day);const ex=exceptions.find(e=>e.day===day);const base=ex??week.find(w=>w.weekday===wd);
  const hours=base?netHours(base):0;const ordinary=base&&base.is_working?Math.min(hours,Number(base.ordinary_hours)):0;
  const attendance:Record<number,number>={};
  for(const a of areas.filter(a=>a.active)){attendance[a.id]=Number(dayAttendance.find(d=>d.day===day&&d.area_id===a.id)?.attendance_pct??monthAttendance.find(m=>m.month===first&&m.area_id===a.id)?.attendance_pct??a.default_attendance_pct);}
  const limiting=areas.filter(a=>a.active&&a.limits_capacity).map(a=>attendance[a.id]);
  return {day,weekday:wd,is_working:!!base?.is_working,hours,ordinary,overtime:Math.max(0,hours-ordinary),exception:!!ex,note:ex?.note??null,attendance,factor:limiting.length?Math.min(...limiting)/100:1};});
}

export type CapacityRow={restriction:Restriction;models:number;demand:number;workingDays:number;maxMonth:number;effectiveMonth:number;coverage:number|null;daysNeeded:number|null;gap:number;extraHours:number};
/** Capacidad del mes por restricción: máximo diario × (horas del día / horas de referencia) × asistencia de áreas clave. */
export function capacitySummary(restrictions:Restriction[],items:DemandItem[],calendar:CalendarDay[],referenceHours:number):CapacityRow[]{
 const working=calendar.filter(d=>d.is_working&&d.hours>0);
 return restrictions.filter(r=>r.active).map(r=>{const matched=items.filter(i=>i.active&&matchesRestriction(i,r));const demand=matched.reduce((s,i)=>s+Number(i.monthly_demand),0);
  const maxMonth=working.length*Number(r.max_per_day);
  const effectiveMonth=working.reduce((s,d)=>s+Number(r.max_per_day)*(referenceHours>0?d.hours/referenceHours:1)*d.factor,0);
  const effectivePerDay=working.length?effectiveMonth/working.length:0;
  const gap=Math.max(0,demand-effectiveMonth);
  // Horas extra para cubrir el faltante al ritmo por hora del grupo y la asistencia promedio del mes.
  const avgFactor=working.length?working.reduce((s,d)=>s+d.factor,0)/working.length:1;
  const perHour=referenceHours>0?Number(r.max_per_day)/referenceHours*avgFactor:0;
  return {restriction:r,models:matched.length,demand,workingDays:working.length,maxMonth,effectiveMonth,coverage:demand>0?effectiveMonth/demand:null,daysNeeded:effectivePerDay>0?demand/effectivePerDay:null,gap,extraHours:gap>0&&perHour>0?gap/perHour:0};});
}

export type ProgramLine={material_code:string;description:string|null;quantity:number};
export type ProgramCheck={restriction:Restriction;planned:number;max:number;excess:number;usage:number};
/** Compara una programación diaria contra los máximos por día. Devuelve también líneas sin datos de demanda. */
export function checkProgram(lines:ProgramLine[],items:DemandItem[],restrictions:Restriction[]){
 const map=new Map(items.map(i=>[i.material_code,i]));
 const unknown=lines.filter(l=>!map.has(l.material_code));
 const checks:ProgramCheck[]=restrictions.filter(r=>r.active).map(r=>{const planned=lines.reduce((s,l)=>{const it=map.get(l.material_code);return it&&matchesRestriction(it,r)?s+Number(l.quantity):s;},0);const max=Number(r.max_per_day);
  return {restriction:r,planned,max,excess:Math.max(0,planned-max),usage:max>0?planned/max:0};});
 const byType:Record<string,number>={};for(const l of lines){const t=map.get(l.material_code)?.mattress_type??'?';byType[t]=(byType[t]??0)+Number(l.quantity);}
 return {checks,unknown,total:lines.reduce((s,l)=>s+Number(l.quantity),0),byType};
}

export type ParsedProgram={name:string;weekday:string|null;sheet:string;lines:(ProgramLine&{source_row:number})[];errors:string[];warnings:string[]};
/** Lee una hoja de programación de entrenamiento: Material · Descripción · cantidad (3.ª columna). El día se toma del nombre de la hoja. */
export function parseProgramSheet(sheet:string,rows:(string|number|null)[][]):ParsedProgram{
 const errors:string[]=[];const warnings:string[]=[];const lines:ParsedProgram['lines']=[];
 const name=plain(sheet);const weekday=WEEKDAYS.find(d=>name.includes(d))??WEEKDAYS.find(d=>rows.slice(0,3).some(r=>plain(r[2])===d))??null;
 if(!weekday)warnings.push('No se reconoció el día en el nombre de la hoja; elígelo antes de guardar.');
 const header=rows.findIndex(r=>plain(r[0])==='MATERIAL');
 if(header<0)errors.push('No se encontró la columna "Material".');
 const seen=new Map<string,number>();
 rows.forEach((r,i)=>{if(header<0||i<=header)return;const line=i+1;if(r.slice(0,3).every(v=>v===null||String(v).trim()===''))return;if(plain(r[0])==='MATERIAL')return;
  const code=String(r[0]??'').trim();const qty=toNumber(r[2]);
  if(!code||/\s/.test(code)){errors.push(`Fila ${line}: código de material vacío o con espacios.`);return;}
  if(qty===null||Number.isNaN(qty)||qty<0){errors.push(`Fila ${line} (${code}): cantidad inválida.`);return;}
  if(seen.has(code))warnings.push(`Fila ${line} (${code}): material repetido (también en fila ${seen.get(code)}); se suman ambas cantidades.`);
  seen.set(code,line);lines.push({material_code:code,description:String(r[1]??'').replace(/\s+/g,' ').trim()||null,quantity:qty,source_row:line});});
 if(!lines.length&&!errors.length)errors.push('La hoja no tiene materiales programados.');
 return {name:sheet.trim(),weekday,sheet,lines,errors,warnings};
}
