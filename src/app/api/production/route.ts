import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan, fetchAll } from '@/lib/planning-server';
import { isoWeekday, WEEKDAYS } from '@/lib/planning';
import { endOfDay, isDay, startOfDay } from '@/lib/qr';
export const runtime = 'nodejs';

const text = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const LEARN_SHEET = 'PRODUCCION_REAL';

async function planner() {
  const ctx = await requireUser();
  if (!canPlan(ctx.profile.role)) throw new Error('Acceso de edición denegado.');
  return ctx;
}

/** Cantidades de un día tomadas de un plan maestro guardado, para precargar el programa real. */
export async function GET(req: Request) {
  try {
    const { db } = await planner();
    const url = new URL(req.url); const date = url.searchParams.get('date'); const run = url.searchParams.get('run') ?? '';
    if (!isDay(date) || !/^[0-9a-f-]{36}$/i.test(run)) throw new Error('Elige la fecha y el plan maestro.');
    const r = await db.from('mps_runs').select('name,result').eq('id', run).maybeSingle();
    if (r.error || !r.data) throw new Error('No se pudo leer ese plan maestro.');
    const result = r.data.result as { days?: { date: string }[]; plan?: { code: string; description: string; daily: number[] }[] };
    const i = (result.days ?? []).findIndex(d => d.date === date);
    if (i < 0) throw new Error(`El plan "${r.data.name}" no tiene el día ${date}.`);
    const lines = (result.plan ?? []).map(p => ({ sapCode: p.code, modelName: p.description, quantity: Math.round(Number(p.daily?.[i]) || 0) })).filter(l => l.quantity > 0);
    return Response.json({ lines, name: r.data.name });
  } catch (e) { return apiError(e); }
}

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const { db } = await planner();
    const b = await req.json();
    if (!isDay(b.date)) throw new Error('Elige la fecha del programa.');

    // Guarda (reemplaza) el programa real del día. Empaque, bodega y el panel lo ven al instante.
    if (b.action === 'save') {
      const lines = Array.isArray(b.lines) ? b.lines.slice(0, 1000).map((l: any) => ({ sap_code: text(l.sapCode, 40).toUpperCase(), model_name: text(l.modelName, 160), quantity: Math.round(Number(l.quantity) || 0) })) : [];
      if (lines.some((l: any) => l.quantity < 0 || l.quantity > 100000)) throw new Error('Las cantidades deben estar entre 0 y 100000.');
      const source = ['MANUAL', 'PLAN_MAESTRO', 'EXCEL'].includes(b.source) ? b.source : 'MANUAL';
      const run = typeof b.mpsRunId === 'string' && /^[0-9a-f-]{36}$/i.test(b.mpsRunId) ? b.mpsRunId : null;
      const r = await db.rpc('lmx_qr_save_plan', { p_date: b.date, p_lines: lines, p_source: source, p_mps_run: run, p_notes: text(b.notes, 300) });
      if (r.error) throw new Error(r.error.message);
      revalidatePath('/production'); revalidatePath('/');
      return Response.json({ saved: r.data });
    }

    // Envía lo realmente empacado ese día a Entrenamiento, para que el plan maestro aprenda de la producción real.
    if (b.action === 'learn') {
      const prev = await db.from('training_programs').select('id').eq('sheet_name', LEARN_SHEET).eq('program_date', b.date).limit(1);
      if (prev.error) throw new Error(prev.error.message);
      if (prev.data?.length) throw new Error('Este día ya se envió a Entrenamiento. Bórralo allí si quieres volver a enviarlo.');
      const labels = await fetchAll<{ sap_code: string; model_name: string; measure: string | null }>((x, y) => db.from('lmx_qr_labels').select('sap_code,model_name,measure').gte('packed_at', startOfDay(b.date)).lte('packed_at', endOfDay(b.date)).order('id').range(x, y));
      if (!labels.length) throw new Error('Ese día no hay colchones empacados.');
      const by = new Map<string, { material_code: string; description: string; quantity: number; source_row: number }>();
      for (const l of labels) { const r = by.get(l.sap_code) ?? { material_code: l.sap_code, description: [l.model_name, l.measure].filter(Boolean).join(' '), quantity: 0, source_row: by.size + 1 }; r.quantity++; by.set(l.sap_code, r); }
      const lines = [...by.values()];
      const [y, m, d] = b.date.split('-');
      const payload = [{ name: `Producción real ${d}/${m}/${y}`, weekday: WEEKDAYS[isoWeekday(b.date) - 1], program_date: b.date, sheet: LEARN_SHEET, lines }];
      const hash = createHash('sha256').update(`${LEARN_SHEET}:${b.date}:${JSON.stringify(lines)}`).digest('hex');
      const r = await db.rpc('import_training_programs', { payload, source_hash: hash, source_name: `Producción real (QR) ${b.date}` });
      if (r.error) throw new Error(r.error.message);
      revalidatePath('/training'); revalidatePath('/production');
      return Response.json({ total: labels.length, models: lines.length });
    }
    throw new Error('Operación no reconocida.');
  } catch (e) { return apiError(e); }
}
