import { apiError } from '@/lib/engineering-api';
import { fetchAll } from '@/lib/planning-server';
import { requireQrUser } from '@/lib/qr-server';
import { labelsPdf } from '@/lib/qr-pdf';
export const runtime = 'nodejs';

/** PDF del lote: una etiqueta por página del tamaño del sticker, lista para la impresora de etiquetas. */
export async function GET(req: Request) {
  try {
    const { db, role } = await requireQrUser();
    if (role !== 'ADMIN') throw new Error('Solo el administrador puede descargar etiquetas.');
    const url = new URL(req.url); const id = Number(url.searchParams.get('batch'));
    const top = Math.min(Math.max(Number(url.searchParams.get('top') ?? 0) || 0, 0), 30);
    if (!Number.isInteger(id) || id < 1) throw new Error('Lote no válido.');
    const [batch, lines] = await Promise.all([
      db.from('lmx_qr_batches').select('*').eq('id', id).single(),
      db.from('lmx_qr_batch_lines').select('id,quantity,observation').eq('batch_id', id),
    ]);
    if (batch.error) throw new Error('Lote no encontrado.');
    if (lines.error) throw new Error(lines.error.message);
    const byLine = new Map((lines.data ?? []).map(l => [l.id, l]));
    const labels = await fetchAll<any>((a, b) => db.from('lmx_qr_labels').select('code,seq,line_id,sap_code,model_name,measure,voided_at').eq('batch_id', id).order('line_id').order('seq').range(a, b));
    const pdf = await labelsPdf(
      { id, programmer: batch.data.programmer, created_at: batch.data.created_at, width_mm: Number(batch.data.sticker_width_mm), height_mm: Number(batch.data.sticker_height_mm) },
      labels.filter(l => !l.voided_at).map(l => ({ ...l, lineTotal: byLine.get(l.line_id)?.quantity ?? 0, observation: byLine.get(l.line_id)?.observation ?? null })),
      top,
    );
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="ETIQUETAS_QR_LOTE_${id}.pdf"`, 'Cache-Control': 'no-store' } });
  } catch (e) { return apiError(e); }
}
