import { requireUser } from '@/lib/auth';
import { apiError } from '@/lib/engineering-api';
import { TEMPLATE_KINDS, templateWorkbook, type TemplateKind } from '@/lib/templates';
export const runtime = 'nodejs';

/** Descarga la plantilla vacía de una carga masiva: ?kind=COSTOS|INVENTARIO|RUTAS|SAP|ENTRENAMIENTO|PRODUCCION */
export async function GET(req: Request) {
  try {
    await requireUser();
    const kind = new URL(req.url).searchParams.get('kind')?.toUpperCase() as TemplateKind;
    if (!TEMPLATE_KINDS.includes(kind)) throw new Error('Plantilla no reconocida.');
    const { buffer, name } = await templateWorkbook(kind);
    return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  } catch (e) { return apiError(e); }
}
