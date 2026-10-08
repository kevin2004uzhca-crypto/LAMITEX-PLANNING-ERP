import { apiError, checkOrigin } from '@/lib/engineering-api';
import { requireQrUser } from '@/lib/qr-server';
import { isDay } from '@/lib/qr';

const text = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Guarda el programa del día (reemplaza el anterior de esa fecha). Solo administrador. */
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const { db, role } = await requireQrUser();
    if (role !== 'ADMIN') throw new Error('Solo el administrador puede cargar el programa.');
    const b = await req.json();
    if (!isDay(b.date)) throw new Error('Elige la fecha del programa.');
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, 500).map((l: any) => ({ sap_code: text(l.sapCode, 40).toUpperCase(), model_name: text(l.modelName, 160), quantity: Math.round(Number(l.quantity) || 0) })) : [];
    if (lines.some((l: any) => l.quantity < 0 || l.quantity > 100000)) throw new Error('Las cantidades deben estar entre 0 y 100000.');
    const source = ['MANUAL', 'PLAN_MAESTRO', 'EXCEL'].includes(b.source) ? b.source : 'MANUAL';
    const run = typeof b.mpsRunId === 'string' && /^[0-9a-f-]{36}$/i.test(b.mpsRunId) ? b.mpsRunId : null;
    const r = await db.rpc('lmx_qr_save_plan', { p_date: b.date, p_lines: lines, p_source: source, p_mps_run: run, p_notes: text(b.notes, 300) });
    if (r.error) throw new Error(r.error.message);
    return Response.json({ saved: r.data });
  } catch (e) { return apiError(e); }
}

/** Cantidades de un día tomadas de un plan maestro guardado (mps_runs), para precargar el programa. */
export async function GET(req: Request) {
  try {
    const { db, role } = await requireQrUser();
    if (role !== 'ADMIN') throw new Error('Solo el administrador puede cargar el programa.');
    const url = new URL(req.url); const date = url.searchParams.get('date'); const run = url.searchParams.get('run') ?? '';
    if (!isDay(date) || !/^[0-9a-f-]{36}$/i.test(run)) throw new Error('Elige la fecha y el plan maestro.');
    const r = await db.from('mps_runs').select('name,result').eq('id', run).maybeSingle();
    if (r.error || !r.data) throw new Error('No se pudo leer ese plan maestro con tu cuenta.');
    const result = r.data.result as { days?: { date: string }[]; plan?: { code: string; description: string; daily: number[] }[] };
    const i = (result.days ?? []).findIndex(d => d.date === date);
    if (i < 0) throw new Error(`El plan "${r.data.name}" no tiene el día ${date}.`);
    const lines = (result.plan ?? []).map(p => ({ sapCode: p.code, modelName: p.description, quantity: Math.round(Number(p.daily?.[i]) || 0) })).filter(l => l.quantity > 0);
    return Response.json({ lines, name: r.data.name });
  } catch (e) { return apiError(e); }
}
