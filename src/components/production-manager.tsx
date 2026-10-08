'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, ClipboardPaste, Download, FileSpreadsheet, GraduationCap, Plus, QrCode, Save, Trash2 } from 'lucide-react';
import { WEEKDAYS, WEEKDAY_LABELS } from '@/lib/planning';
import type { ProductionItem } from '@/lib/production-server';

type Line = { key: number; sapCode: string; modelName: string; quantity: string };
type Run = { id: string; name: string; month: string; status: string };
type Sheet = { sheet: string; weekday: string | null; errors: string[]; warnings: string[]; lines: { sapCode: string; modelName: string; quantity: number }[]; date: string; include: boolean };
let seq = 1;
const line = (l: Partial<Line> = {}): Line => ({ key: seq++, sapCode: '', modelName: '', quantity: '', ...l });
/** Fecha de ese día de la semana dentro de la semana (lunes a domingo) de `date`. */
const dayInWeek = (date: string, weekday: string | null) => {
  const i = weekday ? WEEKDAYS.indexOf(weekday as any) : -1; if (i < 0) return date;
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + i); return d.toISOString().slice(0, 10);
};
const post = async (body: unknown) => { const res = await fetch('/api/production', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await res.json(); if (!res.ok) throw new Error(data.error); return data; };

/** Programa real del día: lo que de verdad se mandó a producir. Empaque y bodega avanzan contra este programa. */
export function ProductionEditor({ date, catalog, initial, runs, source, canEdit, qrAdmin }: { date: string; catalog: ProductionItem[]; initial: { sap_code: string; model_name: string; quantity: number }[]; runs: Run[]; source: string | null; canEdit: boolean; qrAdmin: boolean }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(initial.length ? initial.map(r => line({ sapCode: r.sap_code, modelName: r.model_name, quantity: String(r.quantity) })) : [line()]);
  const [src, setSrc] = useState<{ source: string; run: string | null }>({ source: source ?? 'MANUAL', run: null });
  const [run, setRun] = useState(runs.find(r => r.status === 'APROBADO')?.id ?? runs[0]?.id ?? '');
  const [paste, setPaste] = useState('');
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byCode = useMemo(() => new Map(catalog.map(c => [c.sap_code, c])), [catalog]);
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l));
  const nameOf = (sap: string) => byCode.get(sap.toUpperCase())?.name ?? '';
  const unknownOf = (codes: string[]) => [...new Set(codes.map(c => c.toUpperCase()).filter(c => !byCode.has(c)))];
  const fill = (rows: { sapCode: string; modelName: string; quantity: number }[], s: { source: string; run: string | null }, text: string) => {
    setLines(rows.map(r => line({ sapCode: r.sapCode.toUpperCase(), modelName: nameOf(r.sapCode) || r.modelName || r.sapCode, quantity: String(r.quantity) })));
    setSrc(s); const unknown = unknownOf(rows.map(r => r.sapCode));
    setMsg({ ok: !unknown.length, text: `${text}${unknown.length ? ` Estos códigos no están en Productos ni en Demanda: ${unknown.join(', ')}.` : ' Revisa y presiona Guardar programa.'}` });
  };

  async function fromMps() {
    setMsg(null); setBusy(true);
    try {
      const res = await fetch(`/api/production?date=${date}&run=${run}`); const data = await res.json(); if (!res.ok) throw new Error(data.error);
      if (!data.lines.length) throw new Error(`El plan "${data.name}" no programa colchones para el ${date}.`);
      fill(data.lines, { source: 'PLAN_MAESTRO', run }, `Cargadas ${data.lines.length} filas del plan "${data.name}".`);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo leer el plan maestro.' }); }
    finally { setBusy(false); }
  }

  function fromPaste() {
    // Columnas copiadas de Excel: código SAP … cantidad (tabulador, punto y coma o espacios). La cantidad es la última columna.
    const rows = paste.split(/\r?\n/).map(r => r.trim()).filter(Boolean).map(r => r.split(/\t|;|\s{2,}|,(?=\s*\d+\s*$)/).map(x => x.trim()));
    const parsed = rows.map(r => ({ sapCode: (r[0] ?? '').toUpperCase(), modelName: r.length > 2 ? r[1] : '', quantity: Math.round(Number(String(r[r.length - 1]).replace(',', '.'))) })).filter(r => r.sapCode && Number.isFinite(r.quantity) && r.quantity > 0);
    if (!parsed.length) { setMsg({ ok: false, text: 'No se encontraron filas con código SAP y cantidad.' }); return; }
    setPaste(''); fill(parsed, { source: 'EXCEL', run: null }, `Cargadas ${parsed.length} filas pegadas.`);
  }

  async function upload(file: File | undefined) {
    if (!file) return; setMsg(null); setBusy(true); setSheets(null);
    try {
      const form = new FormData(); form.set('file', file);
      const res = await fetch('/api/production/import', { method: 'POST', body: form }); const data = await res.json(); if (!res.ok) throw new Error(data.error);
      const list: Sheet[] = data.programs.map((p: any) => ({ ...p, date: dayInWeek(date, p.weekday), include: !p.errors.length && p.lines.length > 0 }));
      if (!list.length) throw new Error('El Excel no tiene hojas con programa.');
      const one = list.filter(s => s.include);
      if (list.length === 1 && one.length === 1) fill(one[0].lines, { source: 'EXCEL', run: null }, `Cargadas ${one[0].lines.length} filas de la hoja "${one[0].sheet}".`);
      else setSheets(list);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo leer el Excel.' }); }
    finally { setBusy(false); }
  }

  async function saveSheets() {
    if (!sheets) return; const chosen = sheets.filter(s => s.include);
    const dup = chosen.find((s, i) => chosen.findIndex(x => x.date === s.date) !== i);
    if (dup) { setMsg({ ok: false, text: `Dos hojas tienen la misma fecha (${dup.date}). Cambia una de ellas.` }); return; }
    setMsg(null); setBusy(true);
    try {
      for (const s of chosen) await post({ action: 'save', date: s.date, source: 'EXCEL', notes: `Excel, hoja ${s.sheet}`, lines: s.lines.map(l => ({ ...l, modelName: nameOf(l.sapCode) || l.modelName })) });
      setSheets(null); setMsg({ ok: true, text: `Guardados ${chosen.length} días: ${chosen.map(s => s.date).join(', ')}. Empaque y bodega ya los ven.` }); router.refresh();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo guardar.' }); }
    finally { setBusy(false); }
  }

  async function save() {
    setMsg(null); setBusy(true);
    try {
      const valid = lines.filter(l => l.sapCode && Number(l.quantity) > 0);
      const data = await post({ action: 'save', date, source: src.source, mpsRunId: src.run, lines: valid.map(l => ({ sapCode: l.sapCode, modelName: l.modelName || nameOf(l.sapCode), quantity: Number(l.quantity) })) });
      setMsg({ ok: true, text: valid.length ? `Programa del ${date} guardado: ${data.saved} códigos, ${total} colchones. Empaque, bodega y el panel ya lo ven.` : `Se borró el programa del ${date}.` }); router.refresh();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo guardar.' }); }
    finally { setBusy(false); }
  }

  return <section className="panel">
    <div className="toolbar-row">
      <label>Día de producción<input type="date" value={date} onChange={e => e.target.value && router.push(`/production?date=${e.target.value}`)}/></label>
      <span className="spacer"/>
      <a className="button" href="/api/templates?kind=PRODUCCION"><Download size={16}/>Descargar plantilla</a>
    </div>
    {canEdit && <>
      <div className="toolbar-row">
        <label className="button"><FileSpreadsheet size={16}/>Subir Excel del programa<input type="file" accept=".xlsx" hidden disabled={busy} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }}/></label>
        {runs.length > 0 && <>
          <select aria-label="Plan maestro guardado" value={run} onChange={e => setRun(e.target.value)}>{runs.map(r => <option key={r.id} value={r.id}>{r.name} · {r.month.slice(0, 7)} · {r.status === 'APROBADO' ? 'aprobado' : r.status.toLowerCase()}</option>)}</select>
          <button type="button" disabled={busy || !run} onClick={fromMps}><CalendarRange size={16}/>Traer el día del plan maestro</button>
        </>}
      </div>
      <p className="footnote">El Excel usa el mismo formato que Entrenamiento: una hoja por día con <b>Material · Descripción · Cantidad</b>. Si trae varias hojas (LUNES, MARTES…), cada una se guarda en su fecha de la semana elegida.</p>

      {sheets && <div className="panel">
        <h3>Hojas del Excel</h3>
        <div className="table-scroll"><table><thead><tr><th>Guardar</th><th>Hoja</th><th>Fecha</th><th className="number">Códigos</th><th className="number">Colchones</th><th>Revisión</th></tr></thead><tbody>
          {sheets.map((s, i) => <tr key={s.sheet}>
            <td><input type="checkbox" checked={s.include} disabled={!!s.errors.length || !s.lines.length} onChange={e => setSheets(sheets.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))}/></td>
            <td>{s.sheet}{s.weekday && <small className="muted"><br/>{WEEKDAY_LABELS[WEEKDAYS.indexOf(s.weekday as any)]}</small>}</td>
            <td><input type="date" value={s.date} onChange={e => setSheets(sheets.map((x, j) => j === i ? { ...x, date: e.target.value } : x))}/></td>
            <td className="number">{s.lines.length}</td><td className="number">{s.lines.reduce((t, l) => t + l.quantity, 0)}</td>
            <td>{s.errors.map((x, k) => <small key={k} className="alert error">{x}</small>)}{unknownOf(s.lines.map(l => l.sapCode)).length > 0 && <small className="muted">Códigos fuera de catálogo: {unknownOf(s.lines.map(l => l.sapCode)).join(', ')}</small>}{!s.errors.length && <button type="button" className="compact-button" onClick={() => { fill(s.lines, { source: 'EXCEL', run: null }, `Hoja "${s.sheet}" cargada en el editor.`); setSheets(null); if (s.date !== date) router.push(`/production?date=${s.date}`); }}>Ver en el editor</button>}</td>
          </tr>)}
        </tbody></table></div>
        <p className="footnote">Si una fecha ya tenía programa, se reemplaza por el de la hoja.</p>
        <div className="toolbar-row end"><button type="button" onClick={() => setSheets(null)}>Cancelar</button><button className="primary" disabled={busy || !sheets.some(s => s.include)} onClick={saveSheets}><Save size={16}/>Guardar {sheets.filter(s => s.include).length} días</button></div>
      </div>}

      <details className="qr-paste"><summary><ClipboardPaste size={16}/> Pegar desde Excel (código SAP y cantidad)</summary>
        <textarea rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'3C45327\t20\n3C45527\t15'}/>
        <button type="button" onClick={fromPaste} disabled={!paste.trim()}>Cargar filas pegadas</button>
      </details>
    </>}

    <div className="qr-lines">
      {lines.map((l, i) => <div className="qr-line qr-plan-line" key={l.key}>
        <span className="qr-line-n">{i + 1}</span>
        <label className="grow">Colchón
          <select value={l.sapCode} disabled={!canEdit} onChange={e => set(l.key, { sapCode: e.target.value, modelName: nameOf(e.target.value) })}>
            <option value="">— Elige —</option>
            {l.sapCode && !byCode.has(l.sapCode.toUpperCase()) && <option value={l.sapCode}>{l.modelName || l.sapCode} — {l.sapCode} (fuera del catálogo)</option>}
            {catalog.map(c => <option key={c.sap_code} value={c.sap_code}>{c.name} — {c.sap_code}</option>)}
          </select></label>
        <label>Cantidad<input type="number" min={0} inputMode="numeric" disabled={!canEdit} value={l.quantity} onChange={e => set(l.key, { quantity: e.target.value })}/></label>
        {canEdit && <button type="button" className="compact-button" aria-label="Quitar fila" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [line()])}><Trash2 size={16}/></button>}
      </div>)}
    </div>
    <div className="toolbar-row">
      {canEdit && <button type="button" onClick={() => setLines(ls => [...ls, line()])}><Plus size={16}/>Agregar colchón</button>}
      <strong>Total programado: {total}</strong>
    </div>
    {msg && <p className={`alert ${msg.ok ? 'success' : 'error'}`} role="alert">{msg.text}</p>}
    <div className="toolbar-row">
      {canEdit && <button className="primary" disabled={busy} onClick={save}><Save size={16}/>{busy ? 'Guardando…' : 'Guardar programa'}</button>}
      {qrAdmin && <a className="button" href={`/control/etiquetas?programa=${date}`}><QrCode size={16}/>Generar etiquetas QR de este programa</a>}
    </div>
  </section>;
}

/** Envía lo realmente empacado ese día a Entrenamiento para que el plan maestro aprenda de la producción real. */
export function LearnButton({ date, packed, learned }: { date: string; packed: number; learned: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (learned) return <p className="footnote"><GraduationCap size={14}/> Este día ya está en Entrenamiento como programa real.</p>;
  return <div className="toolbar-row">
    <button disabled={busy || !packed} onClick={async () => {
      if (!confirm(`Se enviarán a Entrenamiento los ${packed} colchones empacados el ${date}. ¿Continuar?`)) return;
      setBusy(true); setMsg(null);
      try { const d = await post({ action: 'learn', date }); setMsg({ ok: true, text: `Enviado a Entrenamiento: ${d.total} colchones de ${d.models} códigos.` }); router.refresh(); }
      catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo enviar.' }); }
      finally { setBusy(false); }
    }}><GraduationCap size={16}/>Enviar lo empacado a Entrenamiento</button>
    <small className="muted">Opcional. Usa lo que de verdad se empacó (escaneado), no lo programado.</small>
    {msg && <p className={`alert ${msg.ok ? 'success' : 'error'}`} role="alert">{msg.text}</p>}
  </div>;
}
