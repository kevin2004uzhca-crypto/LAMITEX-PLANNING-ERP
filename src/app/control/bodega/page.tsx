import { loadCatalog, loadTodayScans, requireQrModule } from '@/lib/qr-server';
import { QrScanStation } from '@/components/qr-scan-station';

export default async function WarehousePage() {
  const { db } = await requireQrModule('bodega');
  const [catalog, scans] = await Promise.all([loadCatalog(db), loadTodayScans(db, 'WAREHOUSE')]);
  return <>
    <p className="eyebrow">CONTROL DE COLCHONES / BODEGA</p>
    <h1 className="qr-title">Ingreso a bodega</h1>
    <p className="muted qr-lead">Escanea cada colchón que llega a bodega. Solo se aceptan etiquetas que ya pasaron por empaque, y cada una se registra una sola vez.</p>
    <QrScanStation stage="WAREHOUSE" catalog={catalog} initialScans={scans}/>
  </>;
}
