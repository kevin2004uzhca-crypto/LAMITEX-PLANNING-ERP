import { redirect } from 'next/navigation';
import { requireQrUser } from '@/lib/qr-server';
import { modulesFor } from '@/lib/qr';

export default async function ControlHome() {
  const { role } = await requireQrUser();
  const mods = modulesFor(role);
  // Cada operario cae directo en su módulo; el administrador empieza por producción.
  redirect(`/control/${role === 'ADMIN' ? 'produccion' : mods[0]}`);
}
