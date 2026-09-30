import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function ERPLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  return <Shell name={profile.display_name || user.email || 'Usuario'} role={profile.role}>{children}</Shell>;
}
