import { apiError } from '@/lib/engineering-api';
import { requireQrUser } from '@/lib/qr-server';
import { loadProduction, productionWorkbook } from '@/lib/qr-report';
import { isDay } from '@/lib/qr';
export const runtime = 'nodejs';

/** Reporte de producción en Excel para la persona que carga la producción al ERP. */
export async function GET(req: Request) {
  try {
    const { db, role } = await requireQrUser();
    if (role !== 'ADMIN' && role !== 'OFFICE') throw new Error('Sin acceso al módulo de producción.');
    const url = new URL(req.url); const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if (!isDay(from) || !isDay(to)) throw new Error('Elige las fechas desde y hasta.');
    if (from > to) throw new Error('La fecha "desde" debe ser anterior o igual a "hasta".');
    const bytes = await productionWorkbook(await loadProduction(db, from, to));
    const name = from === to ? `PRODUCCION_LAMITEX_${from}.xlsx` : `PRODUCCION_LAMITEX_${from}_a_${to}.xlsx`;
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  } catch (e) { return apiError(e); }
}
