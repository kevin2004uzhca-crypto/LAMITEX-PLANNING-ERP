import { loadCatalog, loadDayProgress, loadTodayScans, requireQrModule } from '@/lib/qr-server';
import { todayEc } from '@/lib/qr';
import { QrScanStation } from '@/components/qr-scan-station';

export default async function PackingPage() {
  const { db } = await requireQrModule('empaque');
  const [catalog, scans, progress] = await Promise.all([loadCatalog(db), loadTodayScans(db, 'PACK'), loadDayProgress(db, todayEc())]);
  return <>
    <p className="eyebrow">CONTROL DE COLCHONES / EMPAQUE</p>
    <h1 className="qr-title">Registro de empaque</h1>
    <p className="muted qr-lead">Elige el colchón que estás empacando y escanea su etiqueta. Cada etiqueta se registra una sola vez con la hora exacta.</p>
    <QrScanStation stage="PACK" catalog={catalog} initialScans={scans} progress={progress} closure={progress.closures.find(c => c.stage === 'PACK') ?? null}/>
  </>;
}
