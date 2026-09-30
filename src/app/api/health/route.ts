export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ app: 'lamitex-planning-erp', status: 'ready', instance: process.env.ERP_INSTANCE_ID ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
