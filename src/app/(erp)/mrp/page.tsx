import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { mrpContext } from '@/lib/materials-server';
import { MrpPlanner } from '@/components/mrp-planner';
export default async function Page({searchParams}:{searchParams:Promise<{run?:string}>}){const {db,profile}=await requireUser();const {run}=await searchParams;const context=await mrpContext();const history=await db.from('mrp_runs').select('id,created_at,status').order('created_at',{ascending:false}).limit(15);const saved=run?await db.from('mrp_runs').select('*').eq('id',run).maybeSingle():null;
 return <><p className="eyebrow">PLANIFICACIÓN / BOM SAP</p><h1>Requerimiento de materiales</h1><p className="muted">Programa productos existentes, elige su centro y alternativa SAP y consolida las necesidades por código y unidad.</p><MrpPlanner key={saved?.data?.id??'new'} {...context} canCalculate={['ADMIN','ENGINEERING','PLANNER','SUPERVISOR'].includes(profile.role)} initial={saved?.data??null}/><section className="panel"><h2>Ejecuciones guardadas</h2>{saved?.error&&<p className="alert error">No se pudo abrir esa ejecución.</p>}{history.data?.map(r=><p key={r.id}><Link href={`/mrp?run=${r.id}`}>{new Date(r.created_at).toLocaleString('es-CO',{timeZone:'America/Bogota'})} · {r.status} · {r.id.slice(0,8)}</Link></p>)}{!history.data?.length&&<p>Los cálculos quedarán guardados con sus cantidades y fuentes.</p>}</section></>;
}

