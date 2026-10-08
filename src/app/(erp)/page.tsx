import Link from 'next/link';
import { ArrowUpRight, Boxes, CalendarRange, ClipboardList, PackageCheck, QrCode, Warehouse } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { loadCodes, loadDemand, loadRestrictions } from '@/lib/planning-server';
import { groupsOf } from '@/lib/planning-groups';
import { endOfDay, fmtTime, isDay, startOfDay, todayEc } from '@/lib/qr';
import { loadDayProgress } from '@/lib/qr-server';
import { addDays, loadDailyTotals } from '@/lib/production-server';

const n0 = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 0 });
const pct = (a: number, b: number) => b > 0 ? Math.round(a / b * 100) : null;
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const tone = (p: number | null) => p === null ? '' : p >= 95 ? 'ok' : p >= 80 ? 'mid' : 'low';

/** Panel de producción: cómo va hoy, contra el programa real, y dónde está la brecha. Sin cálculos pesados. */
export default async function ProductionPanel({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { db } = await requireUser();
  const p = await searchParams; const today = todayEc(); const date = isDay(p.date) ? p.date : today;
  const month = date.slice(0, 7);
  const [progress, days, demand, restrictions, codes, monthPacked, pending, rejected] = await Promise.all([
    loadDayProgress(db, date),
    loadDailyTotals(db, addDays(date, -13), date),
    loadDemand(db), loadRestrictions(db), loadCodes(db),
    db.from('lmx_qr_labels').select('id', { count: 'exact', head: true }).gte('packed_at', startOfDay(`${month}-01`)).lte('packed_at', endOfDay(date)),
    db.from('lmx_qr_labels').select('id', { count: 'exact', head: true }).gte('packed_at', startOfDay(date)).lte('packed_at', endOfDay(date)).is('received_at', null).is('voided_at', null),
    db.from('lmx_qr_scans').select('id', { count: 'exact', head: true }).gte('scanned_at', startOfDay(date)).lte('scanned_at', endOfDay(date)).neq('result', 'OK'),
  ]);
  const t = progress.total; const done = pct(t.packed, t.planned); const inWh = pct(t.received, t.packed);
  const missing = Math.max(t.planned - t.packed, 0);
  const closure = (s: 'PACK' | 'WAREHOUSE') => progress.closures.find(c => c.stage === s);

  // Brechas del día: lo que falta empacar y lo que se empacó fuera del programa.
  const gaps = progress.rows.filter(r => r.planned > r.packed).map(r => ({ ...r, gap: r.planned - r.packed })).sort((a, b) => b.gap - a.gap);
  const extra = progress.rows.filter(r => !r.planned && r.packed);

  // Avance por grupo de programación (los mismos grupos de Restricciones: caja, piloto, paneles jumbo, confort…).
  const items = new Map(demand.map(d => [d.material_code, d]));
  const groups = [...restrictions.filter(r => r.active).map(r => ({ key: `R:${r.id}`, label: r.name, max: Number(r.max_per_day) })),
    ...codes.filter(c => c.active && c.kind === 'COLCHON').map(c => ({ key: `C:${c.code}`, label: `Colchón ${c.name}`, max: 0 }))]
    .map(g => ({ ...g, planned: 0, packed: 0 }));
  const byKey = new Map(groups.map(g => [g.key, g]));
  for (const r of progress.rows) for (const k of groupsOf(items.get(r.sap_code), restrictions)) { const g = byKey.get(k); if (g) { g.planned += r.planned; g.packed += r.packed; } }
  const shownGroups = groups.filter(g => g.planned || g.packed);

  // Mes en curso frente a la demanda mensual (una sola línea, sin acumulados por modelo).
  const monthDemand = demand.filter(d => d.active).reduce((s, d) => s + Number(d.monthly_demand), 0);
  const [y, m] = month.split('-').map(Number); const monthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthPct = pct(monthPacked.count ?? 0, monthDemand); const elapsed = Math.round(Number(date.slice(8)) / monthDays * 100);

  const maxDay = Math.max(1, ...days.map(d => Math.max(d.planned, d.packed)));
  const headline = !t.planned && !t.packed ? 'Todavía no hay programa ni escaneos para este día.'
    : !t.planned ? `Se empacaron ${n0.format(t.packed)} colchones, pero no hay programa cargado.`
    : missing === 0 ? `Programa cumplido: ${n0.format(t.packed)} de ${n0.format(t.planned)} empacados.`
    : `Van ${n0.format(t.packed)} de ${n0.format(t.planned)} (${done} %). Faltan ${n0.format(missing)}${gaps[0] ? `; la mayor brecha es ${gaps[0].model_name} (${gaps[0].gap})` : ''}.`;

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">LAMITEX / PANEL DE PRODUCCIÓN</p>
      <h1>{date === today ? 'Producción de hoy' : `Producción del ${date}`}</h1>
      <p className="muted">{headline}</p>
    </div>
      <form className="toolbar-row" action="/"><input type="date" name="date" defaultValue={date} aria-label="Día"/><button>Ver día</button>{date !== today && <Link className="button" href="/">Hoy</Link>}</form>
    </div>

    <div className="metrics">
      <div><span>Programado</span><strong>{n0.format(t.planned)}</strong><small>{t.planned ? <Link href={`/production?date=${date}`}>ver programa real</Link> : <Link href={`/production?date=${date}`}>cargar el programa</Link>}</small></div>
      <div className={`kpi-${tone(done)}`}><span>Empacado</span><strong>{n0.format(t.packed)}</strong><small>{done === null ? 'sin programa' : `${done} % del programa`}</small></div>
      <div className={`kpi-${tone(inWh)}`}><span>En bodega</span><strong>{n0.format(t.received)}</strong><small>{inWh === null ? '—' : `${inWh} % de lo empacado`}{pending.count ? ` · ${pending.count} en camino` : ''}</small></div>
      <div className={missing ? 'kpi-low' : ''}><span>Falta por empacar</span><strong>{n0.format(missing)}</strong><small>{rejected.count ? `${rejected.count} escaneos rechazados` : 'sin rechazos de escaneo'}</small></div>
    </div>

    <div className="qr-closures">
      {(['PACK', 'WAREHOUSE'] as const).map(s => { const c = closure(s); return <div key={s} className={c ? 'done' : ''}><span>{s === 'PACK' ? 'Empaque' : 'Bodega'}</span><strong>{c ? `Día cerrado a las ${fmtTime(c.closed_at)}` : date > today ? 'Pendiente' : 'Trabajando'}</strong><small>{c ? `${c.total_ok} colchones · ${c.closed_by_name ?? ''}` : 'Cuando terminen presionan "Terminar el día"'}</small></div>; })}
    </div>

    <div className="two-columns">
      <section className="panel">
        <h2>Dónde mejorar hoy</h2>
        {!gaps.length && !extra.length && !pending.count && !rejected.count ? <p className="empty-state">{t.planned ? 'Todo lo programado está empacado y sin novedades.' : 'Carga el programa del día en Producción real para ver las brechas.'}</p> : <ul className="prod-list">
          {gaps.slice(0, 6).map(g => <li key={g.sap_code}><span>{g.model_name}<small>{g.sap_code} · {g.packed} de {g.planned}</small></span><b className="badge error">faltan {g.gap}</b></li>)}
          {gaps.length > 6 && <li><span className="muted">Y {gaps.length - 6} códigos más con faltantes.</span><Link href={`/production?date=${date}`}>ver todo</Link></li>}
          {extra.length > 0 && <li><span>Empacados fuera del programa<small>{extra.map(e => e.model_name).slice(0, 3).join(', ')}{extra.length > 3 ? '…' : ''}</small></span><b className="badge warning">{extra.reduce((s, e) => s + e.packed, 0)}</b></li>}
          {!!pending.count && <li><span>Empacados que aún no llegan a bodega<small>se escanean en bodega al recibirlos</small></span><b className="badge warning">{pending.count}</b></li>}
          {!!rejected.count && <li><span>Escaneos rechazados (código repetido, otro modelo…)<small>revísalos en Control QR → Producción</small></span><b className="badge warning">{rejected.count}</b></li>}
        </ul>}
      </section>

      <section className="panel">
        <h2>Avance por grupo</h2>
        {!shownGroups.length ? <p className="empty-state">Sin programa para agrupar. Los grupos son los de Restricciones (caja, piloto, paneles jumbo, confort).</p> : <div className="prod-groups">
          {shownGroups.map(g => { const c = pct(g.packed, g.planned); return <div key={g.key}>
            <div className="prod-group-head"><b>{g.label}</b><span>{g.packed} / {g.planned || '—'}{g.max ? <small> · máx. {n0.format(g.max)} al día</small> : null}</span></div>
            <div className="bar-track"><div className={`bar-fill ${c !== null && c < 80 ? 'over' : ''}`} style={{ width: `${Math.min(c ?? 100, 100)}%` }}/>{g.max > 0 && g.planned > 0 && <div className="bar-limit" style={{ left: `${Math.min(g.max / Math.max(g.planned, g.max) * 100, 100)}%` }} title={`Máximo diario ${g.max}`}/>}</div>
          </div>; })}
        </div>}
        <p className="footnote">Cada colchón cuenta en su tipo y en los grupos de Restricciones a los que pertenece, según la Demanda.</p>
      </section>
    </div>

    <section className="panel">
      <div className="section-heading"><div><h2>Últimos 14 días</h2><p>Barra clara: programado. Barra oscura: empacado. Toca un día para verlo.</p></div>
        <p className="prod-month"><b>{monthLabel(month)}:</b> {n0.format(monthPacked.count ?? 0)} empacados{monthDemand ? ` de ${n0.format(monthDemand)} de demanda mensual (${monthPct} %)` : ''} · va el {elapsed} % del mes</p></div>
      <div className="prod-days" role="img" aria-label="Programado y empacado de los últimos 14 días">
        {days.map(d => { const c = pct(d.packed, d.planned); return <Link key={d.date} href={`/?date=${d.date}`} className={d.date === date ? 'active' : ''} title={`${d.date}: programado ${d.planned}, empacado ${d.packed}, bodega ${d.received}`}>
          <div className="prod-cols"><i style={{ height: `${d.planned / maxDay * 100}%` }}/><i className="packed" style={{ height: `${d.packed / maxDay * 100}%` }}/></div>
          <small className={`kpi-${tone(c)}`}>{c === null ? (d.packed ? n0.format(d.packed) : '·') : `${c}%`}</small>
          <span>{dayLabel(d.date)}</span>
        </Link>; })}
      </div>
    </section>

    <div className="prod-links">
      <Link href={`/production?date=${date}`}><ClipboardList size={20}/><b>Producción real</b><small>Cargar o corregir el programa del día</small><ArrowUpRight size={16}/></Link>
      <Link href="/control"><QrCode size={20}/><b>Control QR</b><small>Etiquetas, empaque y bodega</small><ArrowUpRight size={16}/></Link>
      <Link href="/mps"><CalendarRange size={20}/><b>Plan maestro</b><small>Plan del mes y MRP neto</small><ArrowUpRight size={16}/></Link>
      <Link href="/inventory"><Warehouse size={20}/><b>Inventario</b><small>Stock y cobertura del mes</small><ArrowUpRight size={16}/></Link>
      <Link href="/demand"><Boxes size={20}/><b>Demanda</b><small>Venta mensual por código</small><ArrowUpRight size={16}/></Link>
      <Link href="/training"><PackageCheck size={20}/><b>Entrenamiento</b><small>Programas reales para aprender</small><ArrowUpRight size={16}/></Link>
    </div>
  </>;
}

function monthLabel(month: string) { const [y, m] = month.split('-').map(Number); const s = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }); return s[0].toUpperCase() + s.slice(1); }
