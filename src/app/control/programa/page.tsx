import { loadCatalog, loadDayProgress, requireQrModule } from '@/lib/qr-server';
import { fmtTime, isDay, todayEc } from '@/lib/qr';
import { QrPlanEditor } from '@/components/qr-plan-editor';
import { QrProgressTable } from '@/components/qr-progress';

export default async function DailyPlanPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { db } = await requireQrModule('programa');
  const p = await searchParams; const date = isDay(p.date) ? p.date : todayEc();
  const [catalog, plan, runs, progress] = await Promise.all([
    loadCatalog(db),
    db.from('lmx_qr_daily_plans').select('sap_code,model_name,quantity,source').eq('plan_date', date).order('id'),
    db.from('mps_runs').select('id,name,month,status').neq('status', 'DESCARTADO').order('created_at', { ascending: false }).limit(20),
    loadDayProgress(db, date),
  ]);
  if (plan.error) throw new Error(plan.error.message);
  return <>
    <p className="eyebrow">CONTROL DE COLCHONES / PROGRAMA DIARIO</p>
    <h1 className="qr-title">Programa de producción del día</h1>
    <p className="muted qr-lead">Carga lo que el planificador manda a la planta: tráelo del plan maestro guardado, pégalo desde Excel o escríbelo. Empaque, bodega y producción ven este programa y cómo avanza con cada escaneo.</p>
    <QrPlanEditor key={date} date={date} catalog={catalog} initial={plan.data ?? []} runs={runs.error ? [] : (runs.data ?? []) as any} source={plan.data?.[0]?.source ?? null}/>
    <section className="panel">
      <h2>Avance del {date}</h2>
      <div className="qr-closures">
        {(['PACK', 'WAREHOUSE'] as const).map(s => { const c = progress.closures.find(x => x.stage === s); return <div key={s} className={c ? 'done' : ''}><span>{s === 'PACK' ? 'Empaque' : 'Bodega'}</span><strong>{c ? `Cerrado ${fmtTime(c.closed_at)}` : 'En curso'}</strong><small>{c ? `${c.total_ok} colchones · ${c.closed_by_name ?? ''}` : 'Aún no presiona "Terminar el día"'}</small></div>; })}
      </div>
      <QrProgressTable rows={progress.rows} total={progress.total}/>
    </section>
  </>;
}
