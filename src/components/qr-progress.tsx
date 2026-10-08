import type { ProgressRow } from '@/lib/qr-server';
import { planCompliance } from '@/lib/qr';

/** Programa del día vs. lo escaneado. `focus` resalta la columna de la etapa del operario. */
export function QrProgressTable({ rows, total, focus }: { rows: ProgressRow[]; total: { planned: number; packed: number; received: number }; focus?: 'PACK' | 'WAREHOUSE' }) {
  if (!rows.length) return <p className="muted">No hay programa ni escaneos para este día.</p>;
  const cls = (stage: 'PACK' | 'WAREHOUSE') => focus === stage ? 'qr-focus' : '';
  const c = planCompliance(rows.map(r => ({ planned: r.planned, done: focus === 'WAREHOUSE' ? r.received : r.packed })));
  return <><div className="table-scroll"><table className="qr-table qr-progress">
    <thead><tr><th>Colchón</th><th>Programado</th><th className={cls('PACK')}>Empacado</th><th className={cls('WAREHOUSE')}>Bodega (match)</th><th>Falta</th></tr></thead>
    <tbody>{rows.map(r => {
      const done = focus === 'WAREHOUSE' ? r.received : r.packed;
      const missing = r.planned ? Math.max(r.planned - done, 0) : 0;
      return <tr key={r.sap_code} className={r.planned && done >= r.planned ? 'qr-row-done' : !r.planned ? 'qr-row-extra' : ''}>
        <td>{r.model_name}<small><br/>{r.sap_code}{!r.planned ? ' · fuera de programa' : ''}</small></td>
        <td>{r.planned || '—'}</td><td className={cls('PACK')}>{r.packed}</td><td className={cls('WAREHOUSE')}>{r.received}</td>
        <td className={missing ? 'qr-warn' : ''}>{r.planned ? missing : '—'}</td></tr>;
    })}
      <tr className="qr-total"><td>Total</td><td>{total.planned || '—'}</td><td className={cls('PACK')}>{total.packed}</td><td className={cls('WAREHOUSE')}>{total.received}</td><td>{total.planned ? Math.max(total.planned - (focus === 'WAREHOUSE' ? total.received : total.packed), 0) : '—'}</td></tr>
    </tbody></table></div>
    {c.planned > 0 && <p className="qr-compliance">Cumplimiento del programa: <b>{c.counted} de {c.planned} = {c.pct}%</b>
      {c.excess > 0 && <span className="qr-warn"> · excedente {c.excess}</span>}
      {c.offPlan > 0 && <span className="qr-warn"> · fuera de programa {c.offPlan} (registrado, no suma)</span>}</p>}
  </>;
}
