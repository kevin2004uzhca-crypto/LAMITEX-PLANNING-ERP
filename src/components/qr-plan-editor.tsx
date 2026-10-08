'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, ClipboardPaste, Plus, QrCode, Save, Trash2 } from 'lucide-react';
import { mattressName } from '@/lib/qr';
import type { CatalogItem } from '@/lib/qr-server';

type Line = { key: number; sapCode: string; modelName: string; quantity: string };
type Run = { id: string; name: string; month: string; status: string };
let seq = 1;
const line = (l: Partial<Line> = {}): Line => ({ key: seq++, sapCode: '', modelName: '', quantity: '', ...l });

export function QrPlanEditor({ date, catalog, initial, runs, source }: { date: string; catalog: CatalogItem[]; initial: { sap_code: string; model_name: string; quantity: number }[]; runs: Run[]; source: string | null }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(initial.length ? initial.map(r => line({ sapCode: r.sap_code, modelName: r.model_name, quantity: String(r.quantity) })) : [line()]);
  const [src, setSrc] = useState<{ source: string; run: string | null }>({ source: source ?? 'MANUAL', run: null });
  const [run, setRun] = useState(runs.find(r => r.status === 'APROBADO')?.id ?? runs[0]?.id ?? '');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bySap = useMemo(() => new Map(catalog.map(c => [c.sap_code.toUpperCase(), c])), [catalog]);
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l));
  const nameOf = (sap: string) => { const c = bySap.get(sap.toUpperCase()); return c ? mattressName(c) : ''; };

  async function fromMps() {
    setMsg(null); setBusy(true);
    try {
      const res = await fetch(`/api/qr/plan?date=${date}&run=${run}`); const data = await res.json(); if (!res.ok) throw new Error(data.error);
      if (!data.lines.length) throw new Error(`El plan "${data.name}" no programa colchones para el ${date}.`);
      setLines(data.lines.map((l: any) => line({ sapCode: l.sapCode, modelName: nameOf(l.sapCode) || l.modelName, quantity: String(l.quantity) })));
      setSrc({ source: 'PLAN_MAESTRO', run }); setMsg({ ok: true, text: `Cargadas ${data.lines.length} filas del plan "${data.name}". Revisa y presiona Guardar programa.` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo leer el plan maestro.' }); }
    finally { setBusy(false); }
  }

  function fromPaste() {
    // Dos columnas copiadas de Excel: código SAP y cantidad (tabulador, punto y coma o espacios).
    const rows = paste.split(/\r?\n/).map(r => r.trim()).filter(Boolean).map(r => r.split(/\t|;|\s{2,}|,(?=\s*\d+\s*$)/).map(x => x.trim()));
    const parsed = rows.map(r => ({ sap: (r[0] ?? '').toUpperCase(), qty: Number(String(r[r.length - 1]).replace(',', '.')) })).filter(r => r.sap && Number.isFinite(r.qty) && r.qty > 0);
    if (!parsed.length) { setMsg({ ok: false, text: 'No se encontraron filas con código SAP y cantidad.' }); return; }
    const unknown = parsed.filter(r => !bySap.has(r.sap)).map(r => r.sap);
    setLines(parsed.map(r => line({ sapCode: r.sap, modelName: nameOf(r.sap) || r.sap, quantity: String(Math.round(r.qty)) })));
    setSrc({ source: 'EXCEL', run: null }); setPaste('');
    setMsg({ ok: !unknown.length, text: `Cargadas ${parsed.length} filas.${unknown.length ? ` Revisa estos códigos que no están en el catálogo: ${unknown.join(', ')}.` : ' Revisa y presiona Guardar programa.'}` });
  }

  async function save() {
    setMsg(null); setBusy(true);
    try {
      const valid = lines.filter(l => l.sapCode && Number(l.quantity) > 0);
      const res = await fetch('/api/qr/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, source: src.source, mpsRunId: src.run, lines: valid.map(l => ({ sapCode: l.sapCode, modelName: l.modelName || nameOf(l.sapCode), quantity: Number(l.quantity) })) }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setMsg({ ok: true, text: `Programa del ${date} guardado (${data.saved} colchones distintos, ${total} unidades). Empaque, bodega y producción ya lo ven.` }); router.refresh();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo guardar.' }); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="qr-filter qr-plan-head">
      <label>Fecha del programa<input type="date" value={date} onChange={e => e.target.value && router.push(`/control/programa?date=${e.target.value}`)}/></label>
      {runs.length > 0 && <>
        <label className="grow">Plan maestro guardado
          <select value={run} onChange={e => setRun(e.target.value)}>{runs.map(r => <option key={r.id} value={r.id}>{r.name} · {r.month.slice(0, 7)} · {r.status === 'APROBADO' ? 'aprobado' : r.status.toLowerCase()}</option>)}</select></label>
        <button type="button" disabled={busy || !run} onClick={fromMps}><CalendarRange size={16}/>Traer el día del plan maestro</button>
      </>}
    </div>

    <details className="qr-paste"><summary><ClipboardPaste size={16}/> Pegar desde Excel (código SAP y cantidad)</summary>
      <textarea rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'3C45327\t20\n3C45527\t15'}/>
      <button type="button" onClick={fromPaste} disabled={!paste.trim()}>Cargar filas pegadas</button>
    </details>

    <div className="qr-lines">
      {lines.map((l, i) => <div className="qr-line qr-plan-line" key={l.key}>
        <span className="qr-line-n">{i + 1}</span>
        <label className="grow">Colchón
          <select value={l.sapCode} onChange={e => set(l.key, { sapCode: e.target.value, modelName: nameOf(e.target.value) })}>
            <option value="">— Elige —</option>
            {l.sapCode && !bySap.has(l.sapCode.toUpperCase()) && <option value={l.sapCode}>{l.modelName || l.sapCode} — {l.sapCode} (fuera del catálogo)</option>}
            {catalog.map(c => <option key={c.sku_id} value={c.sap_code}>{mattressName(c)} — {c.sap_code}</option>)}
          </select></label>
        <label>Cantidad<input type="number" min={0} inputMode="numeric" value={l.quantity} onChange={e => set(l.key, { quantity: e.target.value })}/></label>
        <button type="button" className="compact-button" aria-label="Quitar fila" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [line()])}><Trash2 size={16}/></button>
      </div>)}
    </div>
    <div className="toolbar-row">
      <button type="button" onClick={() => setLines(ls => [...ls, line()])}><Plus size={16}/>Agregar colchón</button>
      <strong>Total programado: {total}</strong>
    </div>
    {msg && <p className={`alert ${msg.ok ? 'success' : 'error'}`} role="alert">{msg.text}</p>}
    <div className="toolbar-row">
      <button className="primary" disabled={busy} onClick={save}><Save size={16}/>Guardar programa</button>
      <a className="button" href={`/control/etiquetas?programa=${date}`}><QrCode size={16}/>Generar etiquetas de este programa</a>
    </div>
  </section>;
}
