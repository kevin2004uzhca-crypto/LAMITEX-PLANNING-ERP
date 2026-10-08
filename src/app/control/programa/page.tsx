import { redirect } from 'next/navigation';

/** El programa del día ahora se carga en el ERP, módulo Producción real. */
export default async function DailyPlanPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  redirect(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `/production?date=${date}` : '/production');
}
