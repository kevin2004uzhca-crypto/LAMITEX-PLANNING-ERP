import { apiError, checkOrigin } from '@/lib/engineering-api';
import { requireQrUser } from '@/lib/qr-server';
import { parseLabelCode } from '@/lib/qr';

/** Registra un escaneo de empaque o bodega. La base de datos garantiza una sola lectura válida por etapa. */
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const { db } = await requireQrUser();
    const b = await req.json();
    const stage = b.stage === 'PACK' || b.stage === 'WAREHOUSE' ? b.stage : null;
    if (!stage) throw new Error('Etapa no válida.');
    const code = parseLabelCode(String(b.code ?? ''));
    if (!code) throw new Error('Escanea o escribe el código de la etiqueta.');
    const expected = typeof b.expectedSap === 'string' ? b.expectedSap.trim().slice(0, 40) : '';
    const r = await db.rpc('lmx_qr_register_scan', { p_stage: stage, p_code: code, p_expected_sap: expected || null, p_manual: b.manual === true });
    if (r.error) throw new Error(r.error.message);
    return Response.json(r.data);
  } catch (e) { return apiError(e); }
}
