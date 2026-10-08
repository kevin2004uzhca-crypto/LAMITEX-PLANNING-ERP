'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CameraOff, CheckCircle2, Flag, Keyboard, XCircle } from 'lucide-react';
import { QrCamera } from '@/components/qr-camera';
import { fmtTime, mattressName, parseLabelCode, RESULT_LABEL, type ScanResult, type ScanStage } from '@/lib/qr';
import type { CatalogItem, DayClosure, DayProgress } from '@/lib/qr-server';
import { QrProgressTable } from '@/components/qr-progress';

export type StationScan = { id: number | string; scanned_at: string; scanned_code: string; result: ScanResult; label_sap_code: string | null; model: string | null; manual: boolean; scanned_by_name: string | null };
type Outcome = { ok: boolean; result: ScanResult | 'ERROR'; message: string; code: string; model: string | null; at: string; packedAt?: string | null };

const TEXT = {
  PACK: { title: 'Empaque', pick: 'Colchón que estás empacando', pickHelp: 'Obligatorio. Si la etiqueta es de otro modelo, el sistema la rechaza.', ok: 'Empacados hoy', none: 'Selecciona primero el colchón que estás empacando.' },
  WAREHOUSE: { title: 'Bodega', pick: 'Verificar contra un colchón (opcional)', pickHelp: 'Si eliges uno, se rechazan las etiquetas de otro modelo. Si no, se acepta cualquier modelo empacado.', ok: 'Match hoy (pasan a producción)', none: '' },
} as const;

/** Tono corto de confirmación (agudo) o de rechazo (grave) y vibración en el celular. */
function feedback(ok: boolean) {
  try { navigator.vibrate?.(ok ? 80 : [120, 80, 120]); } catch { /* sin vibración */ }
  try {
    const A = window.AudioContext || (window as any).webkitAudioContext; const ctx = new A();
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = ok ? 1046 : 220; o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.08; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.35)); o.onended = () => ctx.close();
  } catch { /* sin audio */ }
}

export function QrScanStation({ stage, catalog, initialScans, progress, closure }: { stage: ScanStage; catalog: CatalogItem[]; initialScans: StationScan[]; progress: DayProgress; closure: DayClosure | null }) {
  const t = TEXT[stage];
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [closeMsg, setCloseMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // El programa y los contadores de los demás celulares se actualizan solos cada 30 s.
  useEffect(() => { const id = setInterval(() => router.refresh(), 30000); return () => clearInterval(id); }, [router]);
  const planned = progress.rows.filter(r => r.planned > 0);
  const storageKey = `lmx-qr-model-${stage}`;
  const [sap, setSap] = useState('');
  const [filter, setFilter] = useState('');
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [scans, setScans] = useState(initialScans);
  const last = useRef({ code: '', at: 0 });

  useEffect(() => { try { const v = localStorage.getItem(storageKey); if (v && catalog.some(c => c.sap_code === v)) setSap(v); } catch { /* sin almacenamiento */ } }, [storageKey, catalog]);
  const choose = (v: string) => { setSap(v); setOutcome(null); try { v ? localStorage.setItem(storageKey, v) : localStorage.removeItem(storageKey); } catch { /* sin almacenamiento */ } };

  const selected = catalog.find(c => c.sap_code === sap) ?? null;
  const options = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? catalog.filter(c => `${c.model_name} ${c.measure ?? ''} ${c.sap_code} ${c.sap_name ?? ''}`.toLowerCase().includes(q)) : catalog;
    return selected && !list.includes(selected) ? [selected, ...list] : list;
  }, [catalog, filter, selected]);
  const blocked = stage === 'PACK' && !sap;

  const counts = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const s of scans) if (s.result === 'OK' && s.label_sap_code) { const r = m.get(s.label_sap_code) ?? { name: s.model ?? s.label_sap_code, n: 0 }; r.n++; m.set(s.label_sap_code, r); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [scans]);
  const okTotal = counts.reduce((s, [, r]) => s + r.n, 0);
  const rejectedToday = scans.filter(s => s.result !== 'OK').length;

  async function submit(raw: string, isManual: boolean) {
    const code = parseLabelCode(raw);
    if (!code || busy || blocked) return;
    const now = Date.now();
    if (!isManual && last.current.code === code && now - last.current.at < 5000) return; // la cámara sigue viendo la misma etiqueta
    last.current = { code, at: now };
    setBusy(true);
    try {
      const res = await fetch('/api/qr/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, code, expectedSap: sap || null, manual: isManual }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'No se pudo registrar.');
      const model = data.model_name ? mattressName({ model_name: data.model_name, measure: data.measure }) : null;
      setOutcome({ ok: data.ok, result: data.result, message: stage === 'WAREHOUSE' && data.ok ? 'Coincide con el registro de empaque. Pasa a producción.' : data.message, code: data.code, model, at: data.at, packedAt: data.packed_at });
      setScans(s => [{ id: `n${now}`, scanned_at: data.at, scanned_code: data.code, result: data.result, label_sap_code: data.sap_code, model, manual: isManual, scanned_by_name: null }, ...s]);
      feedback(data.ok);
      if (data.ok) router.refresh();
      if (isManual && data.ok) setManual('');
    } catch (e) {
      setOutcome({ ok: false, result: 'ERROR', message: e instanceof Error ? e.message : 'No se pudo registrar.', code, model: null, at: new Date().toISOString() });
      feedback(false);
    } finally {
      setBusy(false); setCooldown(true); setTimeout(() => setCooldown(false), 1200);
    }
  }

  async function closeDay() {
    const label = stage === 'PACK' ? 'empaque' : 'bodega';
    if (!confirm(`¿Terminar el día de ${label}? Se avisará a producción con el total de hoy. Si luego escaneas más, puedes volver a cerrarlo.`)) return;
    setClosing(true); setCloseMsg(null);
    try {
      const res = await fetch('/api/qr/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setCloseMsg({ ok: true, text: `Día cerrado a las ${fmtTime(data.closed_at)} con ${data.total_ok} colchones. Producción ya puede verlo.` }); router.refresh();
    } catch (e) { setCloseMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo cerrar el día.' }); }
    finally { setClosing(false); }
  }

  return <div className="qr-station">
    <div className={`qr-stage-banner ${stage === 'PACK' ? 'pack' : 'warehouse'}`}><strong>{stage === 'PACK' ? 'EMPAQUE' : 'BODEGA'}</strong><span>{stage === 'PACK' ? 'Paso 1 · registra cada colchón terminado' : 'Paso 2 · confirma cada colchón que llega'}</span></div>

    <section className="qr-card">
      <label>{t.pick}
        <input type="search" placeholder="Buscar por modelo, medida o código SAP" value={filter} onChange={e => setFilter(e.target.value)}/>
        <select value={sap} onChange={e => choose(e.target.value)}>
          <option value="">{stage === 'PACK' ? '— Elige el colchón —' : '— Cualquier modelo —'}</option>
          {options.map(c => <option key={c.sku_id} value={c.sap_code}>{mattressName(c)} — {c.sap_code}</option>)}
        </select>
      </label>
      <small className="muted">{t.pickHelp}</small>
      {stage === 'PACK' && planned.length > 0 && <div className="qr-quick"><span>Programa de hoy</span>{planned.map(r => <button type="button" key={r.sap_code} className={sap === r.sap_code ? 'active' : ''} onClick={() => choose(r.sap_code)}>{r.model_name}<small>{r.packed}/{r.planned}</small></button>)}</div>}
      {selected && <div className="qr-selected"><span>Colchón seleccionado</span><strong>{mattressName(selected)}</strong><small>SAP {selected.sap_code}</small></div>}
    </section>

    <section className="qr-card">
      {blocked ? <p className="alert warning">{t.none}</p> : <>
        <button type="button" className={`qr-big ${camera ? '' : 'primary'}`} onClick={() => setCamera(!camera)}>
          {camera ? <><CameraOff size={22}/>Apagar cámara</> : <><Camera size={22}/>Escanear con la cámara</>}
        </button>
        {camera && <QrCamera onCode={text => submit(text, false)} paused={busy || cooldown}/>}
        <form className="qr-manual" onSubmit={e => { e.preventDefault(); submit(manual, true); }}>
          <label><span><Keyboard size={16}/> Ingreso manual del código</span>
            <input value={manual} onChange={e => setManual(e.target.value.toUpperCase())} placeholder="LMX-XXXXXXXXXXXX" autoCapitalize="characters" autoComplete="off" inputMode="text"/>
          </label>
          <button type="submit" disabled={busy || !manual.trim()}>Registrar</button>
        </form>
      </>}
      {busy && <p className="muted" role="status">Registrando…</p>}
      {outcome && <div className={`qr-outcome ${outcome.ok ? 'ok' : 'bad'}`} role="alert">
        {outcome.ok ? <CheckCircle2 size={40}/> : <XCircle size={40}/>}
        <div><strong>{outcome.ok ? (stage === 'WAREHOUSE' ? 'MATCH ✓ EMPAQUE = BODEGA' : 'REGISTRADO · ESPERA A BODEGA') : outcome.result === 'ERROR' ? 'ERROR' : `RECHAZADO · ${RESULT_LABEL[outcome.result as ScanResult]}`}</strong>
          <p>{outcome.message}</p>
          {outcome.model && <p><b>{outcome.model}</b></p>}
          <small>{outcome.code} · {fmtTime(outcome.at)}{stage === 'WAREHOUSE' && outcome.ok && outcome.packedAt ? ` · empacado ${fmtTime(outcome.packedAt)}` : ''}</small></div>
      </div>}
    </section>

    <section className="qr-card">
      <div className="qr-counters"><div><span>{t.ok}</span><strong>{okTotal}</strong></div><div><span>Rechazos hoy</span><strong className={rejectedToday ? 'bad' : ''}>{rejectedToday}</strong></div></div>
      {counts.length > 0 && <table className="qr-table"><thead><tr><th>Colchón</th><th>Cant.</th></tr></thead><tbody>{counts.map(([k, r]) => <tr key={k}><td>{r.name}<small> · {k}</small></td><td>{r.n}</td></tr>)}</tbody></table>}
    </section>

    <section className="qr-card">
      <h3>Programa de hoy vs. escaneado</h3>
      {!progress.hasPlan && <p className="muted">Todavía no se cargó el programa de hoy. Se muestran solo los escaneos.</p>}
      <QrProgressTable rows={progress.rows} total={progress.total} focus={stage}/>
    </section>

    <section className="qr-card">
      <h3>Últimos escaneos de hoy</h3>
      {scans.length === 0 ? <p className="muted">Todavía no hay escaneos hoy.</p> :
        <ul className="qr-log">{scans.slice(0, 40).map(s => <li key={s.id} className={s.result === 'OK' ? 'ok' : 'bad'}>
          <span>{fmtTime(s.scanned_at)}</span><b>{s.result === 'OK' ? '✓' : '✕'} {s.model ?? s.scanned_code}</b>
          <small>{s.scanned_code}{s.result !== 'OK' ? ` · ${RESULT_LABEL[s.result]}` : ''}{s.manual ? ' · manual' : ''}{s.scanned_by_name ? ` · ${s.scanned_by_name}` : ''}</small></li>)}</ul>}
    </section>

    <section className="qr-card">
      <h3>Fin de la jornada</h3>
      {closure ? <p className="alert success">Día cerrado a las {fmtTime(closure.closed_at)} por {closure.closed_by_name} con {closure.total_ok} colchones.</p> : <p className="muted">Cuando termines, presiona el botón para avisar a producción que ya puede cargar lo de hoy.</p>}
      <button type="button" className="qr-big" disabled={closing} onClick={closeDay}><Flag size={20}/>{closure ? 'Volver a cerrar el día (actualizar total)' : 'Terminar el día'}</button>
      {closeMsg && <p className={`alert ${closeMsg.ok ? 'success' : 'error'}`} role="alert">{closeMsg.text}</p>}
    </section>
  </div>;
}
