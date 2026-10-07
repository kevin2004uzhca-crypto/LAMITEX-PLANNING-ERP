import { Download } from 'lucide-react';
import { requireQrModule } from '@/lib/qr-server';
import { loadProduction } from '@/lib/qr-report';
import { fmtDateTime, isDay, RESULT_LABEL, STAGE_LABEL, todayEc } from '@/lib/qr';

const pct = (a: number, b: number) => b ? `${Math.round(a / b * 1000) / 10} %` : '—';

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { db } = await requireQrModule('produccion');
  const p = await searchParams; const today = todayEc();
  let from = isDay(p.from) ? p.from : today, to = isDay(p.to) ? p.to : from;
  if (from > to) [from, to] = [to, from];
  const prod = await loadProduction(db, from, to);
  const { totals } = prod;
  const pending = prod.detail.filter(l => !l.received_at);
  const period = from === to ? `del ${from}` : `del ${from} al ${to}`;

  return <>
    <p className="eyebrow">CONTROL DE COLCHONES / PRODUCCIÓN</p>
    <h1 className="qr-title">Producción terminada y bodega</h1>
    <p className="muted qr-lead">Cada colchón se escanea en empaque y luego en bodega; cuando ambos coinciden hay match y pasa a producción. Se agrupa por fecha de empaque. Descarga el reporte para cargar la producción al ERP.</p>

    <form className="panel qr-filter" method="get">
      <label>Desde<input type="date" name="from" defaultValue={from} max={today}/></label>
      <label>Hasta<input type="date" name="to" defaultValue={to} max={today}/></label>
      <button type="submit">Consultar</button>
      <a className="button primary" href={`/api/qr/report?from=${from}&to=${to}`}><Download size={18}/>Descargar reporte Excel</a>
    </form>

    <div className="metrics compact qr-metrics">
      <div><span>Empacados {period}</span><strong>{totals.packed}</strong><small>Colchones terminados por la planta</small></div>
      <div><span>Match empaque = bodega</span><strong>{totals.received}</strong><small>Pasan a producción · {pct(totals.received, totals.packed)}</small></div>
      <div><span>Faltan en bodega</span><strong className={totals.missing ? 'qr-warn' : ''}>{totals.missing}</strong><small>Empacados sin escaneo de bodega</small></div>
      <div><span>Intentos rechazados</span><strong className={totals.rejected ? 'qr-bad' : ''}>{totals.rejected}</strong><small>Duplicados, otro modelo, sin empaque…</small></div>
    </div>

    <section className="panel">
      <h2>Producción por código SAP</h2>
      {prod.summary.length === 0 ? <p className="muted">No hay colchones empacados {period}.</p> :
        <div className="table-scroll"><table className="qr-table"><thead><tr><th>Código SAP</th><th>Modelo</th><th>Medida</th><th>Empacado</th><th>Match (pasa a producción)</th><th>Falta en bodega</th></tr></thead>
          <tbody>{prod.summary.map(r => <tr key={r.sap_code}><td>{r.sap_code}</td><td>{r.model_name}</td><td>{r.measure}</td><td>{r.packed}</td><td><b>{r.received}</b></td><td className={r.missing ? 'qr-warn' : ''}>{r.missing}</td></tr>)}
            <tr className="qr-total"><td colSpan={3}>Total</td><td>{totals.packed}</td><td>{totals.received}</td><td>{totals.missing}</td></tr></tbody></table></div>}
      <p className="muted">Para cargar la producción usa la columna <b>Match</b>: son los colchones escaneados en empaque y también en bodega. En el rango también ingresaron a bodega {totals.receivedInRange} colchones en total (incluye los empacados en días anteriores).</p>
    </section>

    <section className="panel">
      <h2>Colchones empacados que faltan en bodega ({pending.length})</h2>
      {pending.length === 0 ? <p className="muted">Todo lo empacado {period} ya está en bodega.</p> :
        <div className="table-scroll tall"><table className="qr-table"><thead><tr><th>Etiqueta</th><th>Colchón</th><th>Código SAP</th><th>Empacado</th><th>Empacador</th></tr></thead>
          <tbody>{pending.map(l => <tr key={l.code}><td>{l.code}</td><td>{l.model_name} {l.measure}</td><td>{l.sap_code}</td><td>{fmtDateTime(l.packed_at)}</td><td>{l.packed_name}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel">
      <h2>Intentos rechazados ({prod.rejected.length})</h2>
      {prod.rejected.length === 0 ? <p className="muted">Sin intentos rechazados {period}.</p> :
        <div className="table-scroll tall"><table className="qr-table"><thead><tr><th>Fecha y hora</th><th>Etapa</th><th>Código leído</th><th>Motivo</th><th>SAP esperado</th><th>SAP etiqueta</th><th>Usuario</th></tr></thead>
          <tbody>{prod.rejected.map((r, i) => <tr key={i}><td>{fmtDateTime(r.scanned_at)}</td><td>{STAGE_LABEL[r.stage]}</td><td>{r.scanned_code}</td><td><span className="badge error">{RESULT_LABEL[r.result]}</span></td><td>{r.expected_sap_code}</td><td>{r.label_sap_code}</td><td>{r.scanned_by_name}{r.manual ? ' (manual)' : ''}</td></tr>)}</tbody></table></div>}
    </section>

    <details className="panel">
      <summary><b>Detalle de todas las etiquetas empacadas ({prod.detail.length})</b></summary>
      <div className="table-scroll tall"><table className="qr-table"><thead><tr><th>Etiqueta</th><th>Colchón</th><th>SAP</th><th>Empaque</th><th>Empacador</th><th>Bodega</th><th>Recibió</th></tr></thead>
        <tbody>{prod.detail.map(l => <tr key={l.code}><td>{l.code}</td><td>{l.model_name} {l.measure}</td><td>{l.sap_code}</td><td>{fmtDateTime(l.packed_at)}{l.packed_manual ? ' (manual)' : ''}</td><td>{l.packed_name}</td><td>{fmtDateTime(l.received_at)}{l.received_manual ? ' (manual)' : ''}</td><td>{l.received_name}</td></tr>)}</tbody></table></div>
    </details>
  </>;
}
