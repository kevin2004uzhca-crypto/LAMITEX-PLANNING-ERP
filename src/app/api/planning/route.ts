import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan } from '@/lib/planning-server';
import { normalizeCode } from '@/lib/planning';

const text=(v:unknown,max=300)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const pct=(v:unknown)=>{const n=Number(v);if(v===''||v===null||!Number.isFinite(n)||n<0||n>100)throw new Error('El porcentaje de asistencia debe estar entre 0 y 100.');return n;};
const time=(v:unknown)=>{const s=text(v,5);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw new Error('Usa horas con formato HH:MM.');return s;};
const date=(v:unknown)=>{const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s)))throw new Error('Fecha inválida.');return s;};
function shift(b:any){
 const row={is_working:b.is_working===true,start_time:time(b.start_time),end_time:time(b.end_time),break_minutes:Number(b.break_minutes),ordinary_hours:Number(b.ordinary_hours)};
 if(row.end_time<=row.start_time)throw new Error('La hora de salida debe ser posterior a la de entrada.');
 if(!Number.isInteger(row.break_minutes)||row.break_minutes<0||row.break_minutes>600)throw new Error('El almuerzo/descanso debe estar en minutos (0 a 600).');
 if(!Number.isFinite(row.ordinary_hours)||row.ordinary_hours<0||row.ordinary_hours>24)throw new Error('Horas ordinarias inválidas.');
 return row;
}

export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile}=await requireUser();if(!canPlan(profile.role))return Response.json({error:'Acceso de edición denegado.'},{status:403});
 const b=await req.json();let error;
 switch(b.action){
  case 'restriction':{
   const codes=[...new Set((Array.isArray(b.codes)?b.codes:String(b.codes??'').split(/[,\s/]+/)).map(normalizeCode).filter(Boolean))];
   const sizes=(Array.isArray(b.sizes)?b.sizes:String(b.sizes??'').split(/[,\s/y]+/i)).map((s:unknown)=>String(s).trim()).filter(Boolean).map(Number);
   const row={name:text(b.name,120).toUpperCase(),applies_to:b.applies_to==='PANEL'?'PANEL':'COLCHON',codes,sizes:sizes.length?sizes:null,max_per_day:Number(b.max_per_day),active:b.active!==false,notes:text(b.notes,500)||null,sort:Number(b.sort)||0,updated_at:new Date().toISOString()};
   if(!row.name)throw new Error('Escribe el nombre de la restricción.');if(!codes.length)throw new Error('Indica al menos una letra.');
   if(sizes.some((s:number)=>!Number.isFinite(s)||s<=0))throw new Error('Las medidas deben ser números positivos separados por coma.');
   if(!Number.isFinite(row.max_per_day)||row.max_per_day<0)throw new Error('El máximo por día debe ser un número mayor o igual a 0.');
   const known=await db.from('planning_codes').select('code').eq('kind',row.applies_to).in('code',codes);if(known.error)throw new Error(known.error.message);
   const missing=codes.filter(c=>!known.data.some(k=>k.code===c));if(missing.length)throw new Error(`Las letras ${missing.join(', ')} no existen como tipo de ${row.applies_to==='PANEL'?'panel':'colchón'}.`);
   ({error}=b.id?await db.from('capacity_restrictions').update(row).eq('id',Number(b.id)).select('id').single():await db.from('capacity_restrictions').insert(row));break;}
  case 'restriction-delete':({error}=await db.from('capacity_restrictions').delete().eq('id',Number(b.id)));break;
  case 'area':{
   const row={name:text(b.name,80).toUpperCase(),headcount:b.headcount===''||b.headcount===null||b.headcount===undefined?null:Number(b.headcount),default_attendance_pct:pct(b.default_attendance_pct),limits_capacity:b.limits_capacity===true,active:b.active!==false,notes:text(b.notes,500)||null,sort:Number(b.sort)||0};
   if(!row.name)throw new Error('Escribe el nombre del área.');if(row.headcount!==null&&(!Number.isInteger(row.headcount)||row.headcount<0))throw new Error('El personal debe ser un número entero.');
   ({error}=b.id?await db.from('production_areas').update(row).eq('id',Number(b.id)).select('id').single():await db.from('production_areas').insert(row));break;}
  case 'attendance-month':{
   const month=text(b.month,7);if(!/^\d{4}-\d{2}$/.test(month))throw new Error('Mes inválido.');
   const rows=(b.values as {area_id:number;attendance_pct:string|number}[]).filter(v=>v.attendance_pct!==''&&v.attendance_pct!==null);
   const del=await db.from('attendance_month').delete().eq('month',`${month}-01`).not('area_id','in',`(${rows.map(r=>Number(r.area_id)).join(',')||0})`);if(del.error)throw new Error(del.error.message);
   if(rows.length)({error}=await db.from('attendance_month').upsert(rows.map(r=>({month:`${month}-01`,area_id:Number(r.area_id),attendance_pct:pct(r.attendance_pct)}))));break;}
  case 'attendance-day':{
   const day=date(b.day);const rows=(b.values as {area_id:number;attendance_pct:string|number}[]).filter(v=>v.attendance_pct!==''&&v.attendance_pct!==null);
   const del=await db.from('attendance_day').delete().eq('day',day);if(del.error)throw new Error(del.error.message);
   if(rows.length)({error}=await db.from('attendance_day').insert(rows.map(r=>({day,area_id:Number(r.area_id),attendance_pct:pct(r.attendance_pct),note:text(b.note,300)||null}))));break;}
  case 'week':{const weekday=Number(b.weekday);if(!Number.isInteger(weekday)||weekday<1||weekday>7)throw new Error('Día inválido.');
   ({error}=await db.from('work_week').update(shift(b)).eq('weekday',weekday).select('weekday').single());break;}
  case 'workday':({error}=await db.from('work_days').upsert({day:date(b.day),...shift(b),note:text(b.note,300)||null}));break;
  case 'workday-delete':({error}=await db.from('work_days').delete().eq('day',date(b.day)));break;
  case 'reference-hours':{const h=Number(b.value);if(!Number.isFinite(h)||h<=0||h>24)throw new Error('Las horas de referencia deben estar entre 0 y 24.');
   ({error}=await db.from('planning_settings').update({value:h}).eq('key','reference_hours').select('key').single());break;}
  default:throw new Error('Operación no reconocida.');
 }
 if(error)throw new Error(error.message);
 for(const p of ['/restrictions','/training'])revalidatePath(p);
 return Response.json({ok:true});
}catch(e){return apiError(e);}}
