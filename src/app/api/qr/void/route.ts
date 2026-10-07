import { apiError, checkOrigin } from '@/lib/engineering-api';
import { requireQrUser } from '@/lib/qr-server';
import { parseLabelCode } from '@/lib/qr';

/** Anula una etiqueta dañada o no usada (solo administrador). Queda registrada con motivo y fecha. */
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const { db } = await requireQrUser();
    const b = await req.json();
    const r = await db.rpc('lmx_qr_void_label', { p_code: parseLabelCode(String(b.code ?? '')), p_reason: String(b.reason ?? '').slice(0, 300) });
    if (r.error) throw new Error(r.error.message);
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
