import { requireQrUser } from '@/lib/qr-server';
import { QrShell } from '@/components/qr-shell';
import { modulesFor } from '@/lib/qr';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'LAMITEX · Control de colchones' };

export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  const { name, role, erp } = await requireQrUser();
  return <QrShell name={name} role={role} modules={modulesFor(role)} erp={erp}>{children}</QrShell>;
}
