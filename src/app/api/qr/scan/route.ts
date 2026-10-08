import { apiError, checkOrigin } from '@/lib/engineering-api';
import { requireQrUser } from '@/lib/qr-server';
import { endOfDay, parseLabelCode, planFit, startOfDay, todayEc } from '@/lib/qr';

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
    let expected = typeof b.expectedSap === 'string' ? b.expectedSap.trim().slice(0, 40) : '';
    // Escaneo directo en empaque: el colchón lo dice la propia etiqueta (su código SAP no se puede cambiar).
    // Si la etiqueta no existe, la función la rechaza como "No existe" antes de comparar modelos.
    if (stage === 'PACK' && !expected && b.auto === true) {
      const lb = await db.from('lmx_qr_labels').select('sap_code').eq('code', code).maybeSingle();
      expected = lb.data?.sap_code ?? 'AUTO';
    }
    const r = await db.rpc('lmx_qr_register_scan', { p_stage: stage, p_code: code, p_expected_sap: expected || null, p_manual: b.manual === true });
    if (r.error) throw new Error(r.error.message);
    const data = r.data as Record<string, unknown>;
    if (stage === 'PACK' && data.ok && typeof data.sap_code === 'string') data.plan = await packedVsPlan(db, data.sap_code);
    return Response.json(data);
  } catch (e) { return apiError(e); }
}

/** Avance del colchón recién empacado frente al programa de hoy. Si falla, el escaneo ya quedó registrado igual. */
async function packedVsPlan(db: Awaited<ReturnType<typeof requireQrUser>>['db'], sap: string) {
  try {
    const day = todayEc();
    const [plan, anyPlan, packed] = await Promise.all([
      db.from('lmx_qr_daily_plans').select('quantity').eq('plan_date', day).eq('sap_code', sap),
      db.from('lmx_qr_daily_plans').select('id', { count: 'exact', head: true }).eq('plan_date', day),
      db.from('lmx_qr_labels').select('id', { count: 'exact', head: true }).eq('sap_code', sap).gte('packed_at', startOfDay(day)).lte('packed_at', endOfDay(day)),
    ]);
    if (plan.error || anyPlan.error || packed.error) return null;
    const planned = (plan.data ?? []).reduce((s, p) => s + p.quantity, 0);
    const done = packed.count ?? 0;
    return { status: planFit(planned, done, (anyPlan.count ?? 0) > 0), planned, packed: done };
  } catch { return null; }
}
