'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, CalendarCheck, ClipboardList, LayoutDashboard, LogOut, PackageCheck, QrCode } from 'lucide-react';
import { logout } from '@/app/login/actions';
import { QR_MODULES, ROLE_LABEL, type QrModule, type QrRole } from '@/lib/qr';

const ICONS: Record<QrModule, typeof Boxes> = { programa: CalendarCheck, empaque: PackageCheck, bodega: Boxes, etiquetas: QrCode, produccion: ClipboardList };

export function QrShell({ children, name, role, modules, erp }: { children: React.ReactNode; name: string; role: QrRole; modules: QrModule[]; erp: boolean }) {
  const path = usePathname();
  return <div className="qr-shell">
    <header className="qr-top">
      <Link className="qr-brand" href="/control">LAMITEX<span>CONTROL DE COLCHONES</span></Link>
      <div className="qr-user"><strong>{name}</strong><small>{ROLE_LABEL[role]}</small></div>
      <form action={logout}><button className="qr-logout" aria-label="Cerrar sesión"><LogOut size={18}/><span>Salir</span></button></form>
    </header>
    {(modules.length > 1 || erp) && <nav className="qr-tabs">
      {modules.map(m => { const Icon = ICONS[m]; return <Link key={m} href={`/control/${m}`} className={path.startsWith(`/control/${m}`) ? 'active' : ''}><Icon size={18}/>{QR_MODULES[m].label}</Link>; })}
      {erp && <Link href="/" className="qr-erp-link"><LayoutDashboard size={18}/>Volver al ERP</Link>}
    </nav>}
    <main className="qr-main">{children}</main>
  </div>;
}
