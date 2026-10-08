import { requireUser } from '@/lib/auth';
import { apiError, checkOrigin } from '@/lib/engineering-api';
import { canPlan } from '@/lib/planning-server';
import { readTrainingExcel } from '@/lib/planning-excel';
export const runtime = 'nodejs';

/** Lee el Excel del programa real (mismo formato que Entrenamiento: una hoja por día). Solo valida; se guarda día por día. */
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const { profile } = await requireUser();
    if (!canPlan(profile.role)) throw new Error('Acceso de edición denegado.');
    const form = await req.formData(); const file = form.get('file');
    if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024) throw new Error('Selecciona un Excel .xlsx de hasta 10 MB.');
    const parsed = await readTrainingExcel(Buffer.from(await file.arrayBuffer()));
    return Response.json({ programs: parsed.programs.map(p => ({ sheet: p.sheet, weekday: p.weekday, errors: p.errors, warnings: p.warnings, lines: p.lines.map(l => ({ sapCode: l.material_code, modelName: l.description ?? '', quantity: Math.round(l.quantity) })) })) });
  } catch (e) { return apiError(e); }
}
