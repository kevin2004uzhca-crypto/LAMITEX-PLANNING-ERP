/** Control de colchones con etiquetas QR: definiciones compartidas entre servidor y navegador. */
export type QrRole = 'ADMIN' | 'PACKER' | 'WAREHOUSE' | 'OFFICE';
export type QrModule = 'empaque' | 'bodega' | 'etiquetas' | 'produccion';
export type ScanStage = 'PACK' | 'WAREHOUSE';
export type ScanResult = 'OK' | 'ALREADY_SCANNED' | 'NOT_FOUND' | 'MODEL_MISMATCH' | 'NOT_PACKED' | 'VOIDED';

export const QR_MODULES: Record<QrModule, { label: string; roles: QrRole[] }> = {
  empaque: { label: 'Empaque', roles: ['ADMIN', 'PACKER'] },
  bodega: { label: 'Bodega', roles: ['ADMIN', 'WAREHOUSE'] },
  etiquetas: { label: 'Etiquetas QR', roles: ['ADMIN'] },
  produccion: { label: 'Producción', roles: ['ADMIN', 'OFFICE'] },
};
export const ROLE_LABEL: Record<QrRole, string> = { ADMIN: 'Administrador', PACKER: 'Empacador', WAREHOUSE: 'Bodega', OFFICE: 'Oficina / producción' };
export const modulesFor = (role: QrRole) => (Object.keys(QR_MODULES) as QrModule[]).filter(m => QR_MODULES[m].roles.includes(role));

export const RESULT_LABEL: Record<ScanResult, string> = {
  OK: 'Aceptado', ALREADY_SCANNED: 'Ya escaneado', NOT_FOUND: 'No existe', MODEL_MISMATCH: 'Otro modelo', NOT_PACKED: 'Sin empaque', VOIDED: 'Anulada',
};
export const STAGE_LABEL: Record<ScanStage, string> = { PACK: 'Empaque', WAREHOUSE: 'Bodega' };

/** Extrae el código LMX-XXXXXXXXXXXX de lo que lea la cámara o escriba el usuario (acepta minúsculas y sin guion). */
export function parseLabelCode(raw: string) {
  const s = raw.toUpperCase().replace(/\s+/g, '');
  const m = s.match(/LMX-?([0-9A-F]{12})/);
  if (m) return `LMX-${m[1]}`;
  if (/^[0-9A-F]{12}$/.test(s)) return `LMX-${s}`;
  return s.slice(0, 60);
}

// Ecuador continental: UTC-5 sin horario de verano.
export const TZ = 'America/Guayaquil';
export const todayEc = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const startOfDay = (d: string) => `${d}T00:00:00-05:00`;
export const endOfDay = (d: string) => `${d}T23:59:59.999-05:00`;
export const isDay = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const fmtTime = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleTimeString('es-EC', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
export const fmtDateTime = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('es-EC', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const mattressName = (x: { model_name: string; measure?: string | null }) => [x.model_name, x.measure].filter(Boolean).join(' · ');
