'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LayoutDashboard, Package, GitBranch, Layers, Settings, Menu, LogOut, TrendingUp, Gauge, GraduationCap, DollarSign, Warehouse, Timer, CalendarRange, QrCode, ClipboardList } from 'lucide-react';
import { logout } from '@/app/login/actions';
// Menú por etapas. MRP, Calidad de datos e Importar datos (piloto) siguen disponibles por su dirección, pero ya no se muestran:
// el MRP neto vive en Plan maestro y el piloto quedó superado por las cargas reales.
const sections = [
  ['PRODUCCIÓN', [['/', 'Panel de producción', LayoutDashboard], ['/production', 'Producción real', ClipboardList]]],
  ['PLANIFICACIÓN', [['/demand', 'Demanda', TrendingUp], ['/restrictions', 'Restricciones', Gauge], ['/training', 'Entrenamiento', GraduationCap], ['/mps', 'Plan maestro y MRP', CalendarRange], ['/inventory', 'Inventario', Warehouse]]],
  ['DATOS MAESTROS', [['/products', 'Productos', Package], ['/boms', 'Explorador BOM', GitBranch], ['/material-lists', 'Listas SAP', Layers], ['/materials', 'Materiales / Where-used', Layers], ['/costs', 'Costos', DollarSign], ['/routings', 'Tiempos de producción', Timer]]],
] as const;
export function Shell({ children, name, role, qr }: { children: React.ReactNode; name: string; role: string; qr?: boolean }) {
  const path = usePathname(); const [open, setOpen] = useState(false);
  return <div className="app-shell"><button className="menu-toggle" onClick={() => setOpen(!open)} aria-label="Mostrar navegación"><Menu size={22}/></button><aside className={`sidebar ${open ? 'open' : ''}`}><Link className="wordmark" href="/">LAMITEX<span>PLANNING ERP</span></Link><div className="line-label">LÍNEA RESORPEDIC</div><nav>{sections.map(([title, links]) => <div className="nav-section" key={title}><span>{title}</span>{links.map(([href, label, Icon]) => <Link href={href} key={href} onClick={() => setOpen(false)} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}><Icon size={18}/>{label}</Link>)}{title === 'PRODUCCIÓN' && qr && <Link href="/control" onClick={() => setOpen(false)}><QrCode size={18}/>Control de colchones (QR)</Link>}</div>)}<div className="nav-section"><span>SISTEMA</span>{['ADMIN','ENGINEERING'].includes(role)&&<Link href="/admin/boms" onClick={()=>setOpen(false)} className={path.startsWith('/admin/boms')?'active':''}><Settings size={18}/>Gestión de BOM</Link>}<Link href="/settings" onClick={() => setOpen(false)} className={path.startsWith('/settings') ? 'active' : ''}><Settings size={18}/>Estado del sistema</Link></div></nav><div className="sidebar-user"><strong>{name}</strong><small>{role}</small><form action={logout}><button><LogOut size={16}/> Cerrar sesión</button></form></div></aside><div className="workspace"><header className="topbar"><span>Planificación industrial <b>/</b> Resorpedic</span><span className="status-dot">Sesión activa</span></header><main className="main-content">{children}</main><footer>LAMITEX · Ingeniería, trazabilidad y planificación</footer></div></div>;
}

