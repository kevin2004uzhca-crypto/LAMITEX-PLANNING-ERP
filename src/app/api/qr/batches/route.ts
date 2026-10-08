import { apiError, checkOrigin } from '@/lib/engineering-api';
import { requireQrUser } from '@/lib/qr-server';

const text = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const num = (v: unknown, min: number, max: number, label: string) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}: valor entre ${min} y ${max}.`); return n; };

/** Genera un lote de etiquetas QR (solo administrador). */
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const { db, role } = await requireQrUser();
    if (role !== 'ADMIN') throw new Error('Solo el administrador puede generar etiquetas.');
    const b = await req.json();
    const programmer = text(b.programmer, 120); if (!programmer) throw new Error('Indica quién programa las etiquetas.');
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200).map((l: any, i: number) => ({
      sku_id: num(l.skuId, 1, Number.MAX_SAFE_INTEGER, `Fila ${i + 1}: colchón`),
      quantity: Math.round(num(l.quantity, 1, 2000, `Fila ${i + 1}: cantidad`)),
      observation: text(l.observation, 120),
    })) : [];
    if (!lines.length) throw new Error('Agrega al menos un colchón.');
    const r = await db.rpc('lmx_qr_create_batch', {
      p_programmer: programmer, p_observation: text(b.observation, 300),
      p_width_mm: num(b.widthMm, 20, 300, 'Ancho del sticker (mm)'), p_height_mm: num(b.heightMm, 15, 300, 'Alto del sticker (mm)'), p_lines: lines,
    });
    if (r.error) throw new Error(r.error.message);
    return Response.json({ id: r.data });
  } catch (e) { return apiError(e); }
}
