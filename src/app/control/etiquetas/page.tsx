import { fetchAll } from '@/lib/planning-server';
import { loadCatalog, requireQrModule } from '@/lib/qr-server';
import { isDay } from '@/lib/qr';
import { QrLabelGenerator, type BatchSummary } from '@/components/qr-label-generator';

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ programa?: string }> }) {
  const { db, name } = await requireQrModule('etiquetas');
  const { programa } = await searchParams;
  const [catalog, batches] = await Promise.all([
    loadCatalog(db),
    db.from('lmx_qr_batches').select('id,programmer,observation,sticker_width_mm,sticker_height_mm,total_labels,created_at,lmx_qr_batch_lines(sap_code,model_name,measure,quantity,observation)').order('id', { ascending: false }).limit(30),
  ]);
  if (batches.error) throw new Error(batches.error.message);
  const ids = (batches.data ?? []).map(b => b.id);
  const labels = ids.length ? await fetchAll<any>((a, b) => db.from('lmx_qr_labels').select('batch_id,packed_at,received_at,voided_at').in('batch_id', ids).order('id').range(a, b)) : [];
  const stats = new Map<number, { packed: number; received: number; voided: number }>();
  for (const l of labels) { const s = stats.get(l.batch_id) ?? { packed: 0, received: 0, voided: 0 }; if (l.packed_at) s.packed++; if (l.received_at) s.received++; if (l.voided_at) s.voided++; stats.set(l.batch_id, s); }
  // "Generar etiquetas de este programa": precarga los colchones y cantidades del programa diario.
  let prefill: { skuId: string; quantity: string; observation: string }[] = [];
  if (isDay(programa)) {
    const plan = await db.from('lmx_qr_daily_plans').select('sap_code,quantity').eq('plan_date', programa).order('id');
    const bySap = new Map(catalog.map(c => [c.sap_code.toUpperCase(), c]));
    prefill = (plan.data ?? []).filter(r => bySap.has(r.sap_code)).map(r => ({ skuId: String(bySap.get(r.sap_code)!.sku_id), quantity: String(r.quantity), observation: '' }));
  }
  const list: BatchSummary[] = (batches.data ?? []).map((b: any) => ({ ...b, sticker_width_mm: Number(b.sticker_width_mm), sticker_height_mm: Number(b.sticker_height_mm), lines: b.lmx_qr_batch_lines ?? [], ...(stats.get(b.id) ?? { packed: 0, received: 0, voided: 0 }) }));
  return <>
    <p className="eyebrow">CONTROL DE COLCHONES / ETIQUETAS QR</p>
    <h1 className="qr-title">Generación de etiquetas QR</h1>
    <p className="muted qr-lead">Cada etiqueta tiene un código único que solo se puede escanear una vez en empaque y una vez en bodega. Elige los colchones, la cantidad de cada uno y el tamaño del sticker para descargar el PDF de impresión.</p>
    <QrLabelGenerator catalog={catalog} batches={list} defaultProgrammer={name} prefill={prefill} prefillNote={isDay(programa) ? `Programa del ${programa}` : ''}/>
  </>;
}
