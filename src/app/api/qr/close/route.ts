import { apiError, checkOrigin } from '@/lib/engineering-api';
import { requireQrUser } from '@/lib/qr-server';

/** "Terminar el día" de empaque o bodega: deja constancia para producción. */
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const { db } = await requireQrUser();
    const b = await req.json();
    if (b.stage !== 'PACK' && b.stage !== 'WAREHOUSE') throw new Error('Etapa no válida.');
    const r = await db.rpc('lmx_qr_close_day', { p_stage: b.stage, p_notes: typeof b.notes === 'string' ? b.notes.slice(0, 300) : null });
    if (r.error) throw new Error(r.error.message);
    return Response.json(r.data);
  } catch (e) { return apiError(e); }
}
