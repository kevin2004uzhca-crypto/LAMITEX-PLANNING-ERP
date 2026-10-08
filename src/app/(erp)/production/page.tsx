import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { canPlan } from '@/lib/planning-server';
import { fmtTime, isDay, todayEc } from '@/lib/qr';
import { loadDayProgress } from '@/lib/qr-server';
import { addDays, loadDailyTotals, loadProductionCatalog } from '@/lib/production-server';
import { LearnButton, ProductionEditor } from '@/components/production-manager';
import { QrProgressTable } from '@/components/qr-progress';

const pct = (a: number, b: number) => b > 0 ? Math.round(a / b * 100) : null;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { db, profile } = await requireUser();
  const p = await searchParams; const today = todayEc(); const date = isDay(p.date) ? p.date : today;
  const [catalog, plan, runs, progress, days, learned, qr] = await Promise.all([
    loadProductionCatalog(db),
    db.from('lmx_qr_daily_plans').select('sap_code,model_name,quantity,source').eq('plan_date', date).order('id'),
    db.from('mps_runs').select('id,name,month,status').neq('status', 'DESCARTADO').order('created_at', { ascending: false }).limit(20),
    loadDayProgress(db, date),
    loadDailyTotals(db, addDays(date, -13), date),
    db.from('training_programs').select('id').eq('sheet_name', 'PRODUCCION_REAL').eq('program_date', date).limit(1),
    db.rpc('lmx_qr_role'),
  ]);
  if (plan.error) throw new Error(plan.error.message);
  const canEdit = canPlan(profile.role);
  const t = progress.total; const done = pct(t.packed, t.planned);
  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">PRODUCCIÓN / PROGRAMA REAL</p>
      <h1>Producción real</h1>
      <p className="muted">El programa que de verdad se mandó a producir cada día. Empaque y bodega escanean contra este programa y el panel muestra su avance.</p>
    </div><Link className="button" href="/">Ver el panel</Link></div>

    <ProductionEditor key={date} date={date} catalog={catalog} initial={plan.data ?? []} runs={runs.error ? [] : (runs.data ?? []) as any} source={plan.data?.[0]?.source ?? null} canEdit={canEdit} qrAdmin={!qr.error && qr.data === 'ADMIN'}/>

    <section className="panel">
      <div className="section-heading"><div><h2>Avance del {date}</h2><p>{t.planned ? `${t.packed} de ${t.planned} empacados${done !== null ? ` (${done} %)` : ''} · ${t.received} recibidos en bodega.` : 'Sin programa cargado para este día.'}</p></div></div>
      <div className="qr-closures">
        {(['PACK', 'WAREHOUSE'] as const).map(s => { const c = progress.closures.find(x => x.stage === s); return <div key={s} className={c ? 'done' : ''}><span>{s === 'PACK' ? 'Empaque' : 'Bodega'}</span><strong>{c ? `Cerrado ${fmtTime(c.closed_at)}` : date > today ? 'Pendiente' : 'En curso'}</strong><small>{c ? `${c.total_ok} colchones · ${c.closed_by_name ?? ''}` : 'Aún no presiona "Terminar el día"'}</small></div>; })}
      </div>
      <QrProgressTable rows={progress.rows} total={t}/>
      {canEdit && <LearnButton date={date} packed={t.packed} learned={!!learned.data?.length}/>}
    </section>

    <section className="panel">
      <h2>Últimos 14 días</h2>
      <div className="table-scroll"><table><thead><tr><th>Día</th><th className="number">Programado</th><th className="number">Empacado</th><th className="number">En bodega</th><th>Cumplimiento</th></tr></thead><tbody>
        {[...days].reverse().map(d => { const c = pct(d.packed, d.planned); return <tr key={d.date}>
          <td><Link href={`/production?date=${d.date}`}>{d.date === date ? <b>{d.date}</b> : d.date}</Link></td>
          <td className="number">{d.planned || '—'}</td><td className="number">{d.packed || '—'}</td><td className="number">{d.received || '—'}</td>
          <td>{c === null ? <small className="muted">{d.packed ? 'sin programa' : '—'}</small> : <div className="prod-bar"><div className="bar-track"><div className={`bar-fill ${c < 80 ? 'over' : ''}`} style={{ width: `${Math.min(c, 100)}%` }}/></div><b>{c} %</b></div>}</td>
        </tr>; })}
      </tbody></table></div>
    </section>
  </>;
}
