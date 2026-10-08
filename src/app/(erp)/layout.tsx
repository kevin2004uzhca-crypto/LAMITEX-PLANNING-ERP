import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function ERPLayout({ children }: { children: React.ReactNode }) {
  const { db, user, profile } = await requireUser();
  const qr = await db.rpc('lmx_qr_role');
  return <Shell name={profile.display_name || user.email || 'Usuario'} role={profile.role} qr={!qr.error && !!qr.data}>{children}</Shell>;
}
