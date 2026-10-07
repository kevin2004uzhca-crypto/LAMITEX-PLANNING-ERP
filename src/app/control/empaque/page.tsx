import { loadCatalog, loadTodayScans, requireQrModule } from '@/lib/qr-server';
import { QrScanStation } from '@/components/qr-scan-station';

export default async function PackingPage() {
  const { db } = await requireQrModule('empaque');
  const [catalog, scans] = await Promise.all([loadCatalog(db), loadTodayScans(db, 'PACK')]);
  return <>
    <p className="eyebrow">CONTROL DE COLCHONES / EMPAQUE</p>
    <h1 className="qr-title">Registro de empaque</h1>
    <p className="muted qr-lead">Elige el colchón que estás empacando y escanea su etiqueta. Cada etiqueta se registra una sola vez con la hora exacta.</p>
    <QrScanStation stage="PACK" catalog={catalog} initialScans={scans}/>
  </>;
}
