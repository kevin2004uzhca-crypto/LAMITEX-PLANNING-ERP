'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Download, Plus, QrCode, Trash2 } from 'lucide-react';
import { fmtDateTime, mattressName } from '@/lib/qr';
import type { CatalogItem } from '@/lib/qr-server';

export type BatchSummary = { id: number; programmer: string; observation: string | null; sticker_width_mm: number; sticker_height_mm: number; total_labels: number; created_at: string;
  lines: { sap_code: string; model_name: string; measure: string | null; quantity: number; observation: string | null }[]; packed: number; received: number; voided: number };
type Line = { key: number; skuId: string; filter: string; quantity: string; observation: string };

const PRESETS = [
  { label: '100 × 50 mm (Zebra, recomendado)', w: 100, h: 50 }, { label: '100 × 75 mm', w: 100, h: 75 }, { label: '100 × 100 mm', w: 100, h: 100 },
  { label: '75 × 50 mm', w: 75, h: 50 }, { label: '60 × 40 mm', w: 60, h: 40 }, { label: '50 × 25 mm', w: 50, h: 25 },
];
let seq = 1;
const newLine = (): Line => ({ key: seq++, skuId: '', filter: '', quantity: '', observation: '' });

export function QrLabelGenerator({ catalog, batches, defaultProgrammer, prefill = [], prefillNote = '' }: { catalog: CatalogItem[]; batches: BatchSummary[]; defaultProgrammer: string; prefill?: { skuId: string; quantity: string; observation: string }[]; prefillNote?: string }) {
  const router = useRouter();
  const [programmer, setProgrammer] = useState(defaultProgrammer);
  const [observation, setObservation] = useState(prefillNote);
  const [w, setW] = useState('100'); const [h, setH] = useState('50');
  // Ajuste de impresión: baja el contenido para que la separación del rollo no corte el QR. Se recuerda en este equipo.
  const [top, setTop] = useState('5');
  useEffect(() => { try { const v = localStorage.getItem('lmx-qr-top-mm'); if (v !== null) setTop(v); } catch { /* sin almacenamiento */ } }, []);
  const saveTop = (v: string) => { setTop(v); try { localStorage.setItem('lmx-qr-top-mm', v); } catch { /* sin almacenamiento */ } };
  const pdfUrl = (id: number) => `/api/qr/pdf?batch=${id}&top=${Number(top) || 0}`;
  const [lines, setLines] = useState<Line[]>(prefill.length ? prefill.map(l => ({ ...newLine(), ...l })) : [newLine()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [voidCode, setVoidCode] = useState(''); const [voidReason, setVoidReason] = useState('');
  const [voidMsg, setVoidMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const byId = useMemo(() => new Map(catalog.map(c => [String(c.sku_id), c])), [catalog]);
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const preset = PRESETS.find(p => String(p.w) === w && String(p.h) === h);
  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l));
  const W = Number(w) || 100, H = Number(h) || 50, scale = Math.min(260 / W, 180 / H);

  async function generate() {
    setMsg(null);
    const valid = lines.filter(l => l.skuId || l.quantity);
    if (!valid.length) { setMsg({ ok: false, text: 'Agrega al menos un colchón con su cantidad.' }); return; }
    const bad = valid.find(l => !l.skuId || !(Number(l.quantity) >= 1));
    if (bad) { setMsg({ ok: false, text: 'Cada fila necesita un colchón y una cantidad de 1 o más.' }); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/qr/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        programmer, observation, widthMm: W, heightMm: H, lines: valid.map(l => ({ skuId: Number(l.skuId), quantity: Number(l.quantity), observation: l.observation })) }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setMsg({ ok: true, text: `Lote ${data.id} generado con ${total} etiquetas. Descargando el PDF…` });
      setLines([newLine()]); setObservation('');
      window.location.href = pdfUrl(data.id);
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo generar.' }); }
    finally { setBusy(false); }
  }

  async function voidLabel(e: React.FormEvent) {
    e.preventDefault(); setVoidMsg(null);
    const res = await fetch('/api/qr/void', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: voidCode, reason: voidReason }) });
    const data = await res.json();
    if (!res.ok) { setVoidMsg({ ok: false, text: data.error }); return; }
    setVoidMsg({ ok: true, text: `Etiqueta ${voidCode} anulada. Ya no se puede escanear.` }); setVoidCode(''); setVoidReason(''); router.refresh();
  }

  return <div className="qr-labels">
    <section className="panel">
      <h2>Nuevo lote de etiquetas</h2>
      <div className="qr-form-grid">
        <label>Programado por<input value={programmer} onChange={e => setProgrammer(e.target.value)} maxLength={120}/></label>
        <label>Observación del lote<input value={observation} onChange={e => setObservation(e.target.value)} maxLength={300} placeholder="Ej.: producción semana 41, turno día"/></label>
      </div>

      <h3>Colchones y cantidades</h3>
      <div className="qr-lines">
        {lines.map((l, i) => {
          const q = l.filter.trim().toLowerCase();
          const opts = q ? catalog.filter(c => `${c.model_name} ${c.measure ?? ''} ${c.sap_code} ${c.sap_name ?? ''}`.toLowerCase().includes(q)) : catalog;
          const sel = byId.get(l.skuId);
          return <div className="qr-line" key={l.key}>
            <span className="qr-line-n">{i + 1}</span>
            <label>Buscar<input type="search" value={l.filter} onChange={e => set(l.key, { filter: e.target.value })} placeholder="Modelo, medida o SAP"/></label>
            <label className="grow">Colchón (modelo / código SAP)
              <select value={l.skuId} onChange={e => set(l.key, { skuId: e.target.value })}>
                <option value="">— Elige —</option>
                {sel && !opts.includes(sel) && <option value={l.skuId}>{mattressName(sel)} — {sel.sap_code}</option>}
                {opts.map(c => <option key={c.sku_id} value={c.sku_id}>{mattressName(c)} — {c.sap_code}</option>)}
              </select></label>
            <label>Cantidad<input type="number" min={1} max={2000} inputMode="numeric" value={l.quantity} onChange={e => set(l.key, { quantity: e.target.value })}/></label>
            <label className="grow">Observación (sale en la etiqueta)<input value={l.observation} maxLength={120} onChange={e => set(l.key, { observation: e.target.value })}/></label>
            <button type="button" className="compact-button" aria-label="Quitar fila" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [newLine()])}><Trash2 size={16}/></button>
          </div>;
        })}
      </div>
      <button type="button" onClick={() => setLines(ls => [...ls, newLine()])}><Plus size={16}/>Agregar colchón</button>

      <h3>Tamaño del sticker</h3>
      <div className="qr-size">
        <div className="qr-form-grid">
          <label>Medida
            <select value={preset ? `${preset.w}x${preset.h}` : 'custom'} onChange={e => { if (e.target.value !== 'custom') { const [a, b] = e.target.value.split('x'); setW(a); setH(b); } }}>
              {PRESETS.map(p => <option key={p.label} value={`${p.w}x${p.h}`}>{p.label}</option>)}
              <option value="custom">Personalizado</option>
            </select></label>
          <label>Ancho (mm)<input type="number" min={20} max={300} value={w} onChange={e => setW(e.target.value)}/></label>
          <label>Alto (mm)<input type="number" min={15} max={300} value={h} onChange={e => setH(e.target.value)}/></label>
          <label>Bajar contenido (mm)<input type="number" min={0} max={30} step={0.5} value={top} onChange={e => saveTop(e.target.value)}/></label>
        </div>
        <div className="qr-preview" style={{ width: W * scale, height: H * scale, paddingTop: 6 + (Number(top) || 0) * scale, flexDirection: W >= H * 1.25 ? 'row' : 'column' }} aria-label="Vista previa del sticker">
          <QrCode style={{ width: Math.min(W, H) * scale * 0.8, height: Math.min(W, H) * scale * 0.8 }}/>
          <div><b>MODELO DEL COLCHÓN</b><small>Observación</small><small>LMX-XXXXXXXXXXXX</small></div>
        </div>
      </div>
      <p className="muted">El PDF trae una etiqueta por página del tamaño del sticker. En la impresora de etiquetas, imprime al 100 % (tamaño real, sin “ajustar a la página”). Si la separación entre stickers corta el QR, sube “Bajar contenido”; el cambio aplica también al volver a descargar lotes anteriores.</p>

      {msg && <p className={`alert ${msg.ok ? 'success' : 'error'}`} role="alert">{msg.text}</p>}
      <button className="primary qr-big" disabled={busy || total < 1} onClick={generate}><QrCode size={20}/>{busy ? 'Generando…' : `Generar ${total || ''} etiquetas y descargar PDF`}</button>
    </section>

    <section className="panel">
      <h2>Lotes generados</h2>
      {batches.length === 0 ? <p className="muted">Todavía no se generan etiquetas.</p> :
        <div className="table-scroll"><table className="qr-table"><thead><tr><th>Lote</th><th>Fecha</th><th>Programó</th><th>Colchones</th><th>Etiquetas</th><th>Empacadas</th><th>En bodega</th><th>Sticker</th><th></th></tr></thead>
          <tbody>{batches.map(b => <tr key={b.id}>
            <td>{b.id}</td><td>{fmtDateTime(b.created_at)}</td><td>{b.programmer}{b.observation && <small className="muted"><br/>{b.observation}</small>}</td>
            <td>{b.lines.map((l, i) => <div key={i}>{l.quantity} × {mattressName(l)} <small className="muted">({l.sap_code})</small></div>)}</td>
            <td>{b.total_labels}{b.voided ? <small className="muted"><br/>{b.voided} anuladas</small> : null}</td><td>{b.packed}</td><td>{b.received}</td><td>{b.sticker_width_mm}×{b.sticker_height_mm} mm</td>
            <td><a className="button compact-button" href={pdfUrl(b.id)}><Download size={16}/>PDF</a></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel">
      <h2>Anular una etiqueta</h2>
      <p className="muted">Para stickers dañados, mal impresos o que no se usarán. Una etiqueta anulada ya no se puede escanear. No se pueden anular etiquetas que ya ingresaron a bodega.</p>
      <form className="qr-form-grid" onSubmit={voidLabel}>
        <label>Código de la etiqueta<input value={voidCode} onChange={e => setVoidCode(e.target.value.toUpperCase())} placeholder="LMX-XXXXXXXXXXXX" required/></label>
        <label>Motivo<input value={voidReason} onChange={e => setVoidReason(e.target.value)} required maxLength={300} placeholder="Ej.: sticker dañado en impresión"/></label>
        <button type="submit"><Ban size={16}/>Anular etiqueta</button>
      </form>
      {voidMsg && <p className={`alert ${voidMsg.ok ? 'success' : 'error'}`} role="alert">{voidMsg.text}</p>}
    </section>
  </div>;
}
