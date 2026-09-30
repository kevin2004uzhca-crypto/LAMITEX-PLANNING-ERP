import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'LAMITEX · Planning ERP', description: 'Ingeniería de producto y planificación Resorpedic' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
