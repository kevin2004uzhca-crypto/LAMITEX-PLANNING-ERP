import { requireUser } from '@/lib/auth';
import { apiError } from '@/lib/engineering-api';
import { fetchAll, loadDemand } from '@/lib/planning-server';
import { demandReport, demandTemplate } from '@/lib/planning-excel';
export const runtime='nodejs';

const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const isDate=(v:string|null):v is string=>!!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v));
// Ecuador continental: UTC-5 sin horario de verano.
const startOf=(d:string)=>`${d}T00:00:00-05:00`;
const endOf=(d:string)=>`${d}T23:59:59.999-05:00`;
const file=(bytes:Buffer,name:string)=>new Response(new Uint8Array(bytes),{headers:{'Content-Type':XLSX,'Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store'}});

export async function GET(req:Request){try{
 const {db}=await requireUser();const url=new URL(req.url);
 const template=url.searchParams.get('template');
 if(template==='empty')return file(await demandTemplate([]),'PLANTILLA_DEMANDAS_LAMITEX.xlsx');
 if(template==='current')return file(await demandTemplate((await loadDemand(db)).filter(d=>d.active)),'DEMANDAS_LAMITEX_VIGENTE.xlsx');
 const from=url.searchParams.get('from'),to=url.searchParams.get('to');
 if(!isDate(from)||!isDate(to))throw new Error('Elige las fechas desde y hasta.');
 if(from>to)throw new Error('La fecha "desde" debe ser anterior o igual a "hasta".');
 const [atFrom,atTo,changes]=await Promise.all([
  fetchAll<any>((a,b)=>db.rpc('demand_as_of',{at_time:startOf(from)}).range(a,b)),
  fetchAll<any>((a,b)=>db.rpc('demand_as_of',{at_time:endOf(to)}).range(a,b)),
  fetchAll<any>((a,b)=>db.from('demand_history').select('*').gte('changed_at',startOf(from)).lte('changed_at',endOf(to)).order('changed_at').order('id').range(a,b))]);
 if(!atTo.length)throw new Error(`No hay demanda registrada hasta el ${to}.`);
 return file(await demandReport(from,to,atFrom,atTo,changes),`REPORTE_DEMANDA_${from}_a_${to}.xlsx`);
}catch(e){return apiError(e);}}
