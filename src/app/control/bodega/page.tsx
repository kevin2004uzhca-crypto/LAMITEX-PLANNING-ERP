import { loadCatalog, loadDayProgress, loadTodayScans, requireQrModule } from '@/lib/qr-server';
import { todayEc } from '@/lib/qr';
import { QrScanStation } from '@/components/qr-scan-station';

export default async function WarehousePage() {
  const { db } = await requireQrModule('bodega');
  const [catalog, scans, progress] = await Promise.all([loadCatalog(db), loadTodayScans(db, 'WAREHOUSE'), loadDayProgress(db, todayEc())]);
  return <>
    <p className="eyebrow">CONTROL DE COLCHONES / BODEGA</p>
    <h1 className="qr-title">Ingreso a bodega</h1>
    <p className="muted qr-lead">Escanea cada colchón que llega a bodega. Solo se aceptan etiquetas que ya pasaron por empaque, y cada una se registra una sola vez.</p>
    <QrScanStation stage="WAREHOUSE" catalog={catalog} initialScans={scans} progress={progress} closure={progress.closures.find(c => c.stage === 'WAREHOUSE') ?? null}/>
  </>;
}
