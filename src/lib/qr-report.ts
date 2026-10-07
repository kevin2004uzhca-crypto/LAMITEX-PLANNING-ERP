import 'server-only';
import ExcelJS from 'exceljs';
import { fetchAll } from '@/lib/planning-server';
import { endOfDay, fmtDateTime, RESULT_LABEL, STAGE_LABEL, startOfDay, type ScanResult, type ScanStage } from '@/lib/qr';
import type { supabaseServer } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof supabaseServer>>;
export type ProdLabel = { code: string; batch_id: number; sap_code: string; model_name: string; measure: string | null; packed_at: string; packed_manual: boolean | null; received_at: string | null; received_manual: boolean | null; packed_name: string | null; received_name: string | null };
export type ProdRow = { sap_code: string; model_name: string; measure: string | null; packed: number; received: number; missing: number };
export type Rejection = { scanned_at: string; stage: ScanStage; scanned_code: string; result: ScanResult; expected_sap_code: string | null; label_sap_code: string | null; scanned_by_name: string | null; manual: boolean };

/**
 * Producción del rango (por fecha de empaque, hora de Ecuador):
 * empacado = salió de la planta; confirmado = ese mismo colchón ya fue recibido en bodega.
 */
export async function loadProduction(db: Db, from: string, to: string) {
  const a = startOfDay(from), b = endOfDay(to);
  const [labels, okScans, rejected, receivedInRange] = await Promise.all([
    fetchAll<any>((x, y) => db.from('lmx_qr_labels').select('id,code,batch_id,sap_code,model_name,measure,packed_at,packed_manual,received_at,received_manual').gte('packed_at', a).lte('packed_at', b).order('packed_at').range(x, y)),
    fetchAll<any>((x, y) => db.from('lmx_qr_scans').select('label_id,stage,scanned_by_name').eq('result', 'OK').gte('scanned_at', a).order('id').range(x, y)),
    fetchAll<Rejection>((x, y) => db.from('lmx_qr_scans').select('scanned_at,stage,scanned_code,result,expected_sap_code,label_sap_code,scanned_by_name,manual').neq('result', 'OK').gte('scanned_at', a).lte('scanned_at', b).order('scanned_at', { ascending: false }).range(x, y)),
    db.from('lmx_qr_labels').select('id', { count: 'exact', head: true }).gte('received_at', a).lte('received_at', b),
  ]);
  const who = new Map<string, string>(okScans.map(s => [`${s.stage}:${s.label_id}`, s.scanned_by_name]));
  const detail: ProdLabel[] = labels.map(l => ({ code: l.code, batch_id: l.batch_id, sap_code: l.sap_code, model_name: l.model_name, measure: l.measure, packed_at: l.packed_at, packed_manual: l.packed_manual, received_at: l.received_at, received_manual: l.received_manual, packed_name: who.get(`PACK:${l.id}`) ?? null, received_name: who.get(`WAREHOUSE:${l.id}`) ?? null }));
  const rows = new Map<string, ProdRow>();
  for (const l of detail) {
    const r = rows.get(l.sap_code) ?? { sap_code: l.sap_code, model_name: l.model_name, measure: l.measure, packed: 0, received: 0, missing: 0 };
    r.packed++; if (l.received_at) r.received++; else r.missing++;
    rows.set(l.sap_code, r);
  }
  const summary = [...rows.values()].sort((x, y) => x.model_name.localeCompare(y.model_name) || (x.measure ?? '').localeCompare(y.measure ?? ''));
  const totals = { packed: detail.length, received: detail.filter(l => l.received_at).length, missing: detail.filter(l => !l.received_at).length, rejected: rejected.length, receivedInRange: receivedInRange.count ?? 0 };
  return { from, to, detail, summary, rejected, totals };
}
export type Production = Awaited<ReturnType<typeof loadProduction>>;

const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C6975' } } as const;
function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns; ws.addRows(rows);
  const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = HEAD;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export async function productionWorkbook(p: Production) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'LAMITEX Planning ERP'; wb.created = new Date();
  const period = p.from === p.to ? p.from : `${p.from} a ${p.to}`;
  const load = sheet(wb, 'Carga producción', [
    { header: 'Código SAP', key: 'sap', width: 16 }, { header: 'Modelo', key: 'model', width: 34 }, { header: 'Medida', key: 'measure', width: 14 },
    { header: 'Producción a cargar (match empaque + bodega)', key: 'received', width: 24 }, { header: 'Empacado', key: 'packed', width: 12 }, { header: 'Falta en bodega', key: 'missing', width: 15 },
  ], p.summary.map(r => ({ sap: r.sap_code, model: r.model_name, measure: r.measure, received: r.received, packed: r.packed, missing: r.missing })));
  const t = load.addRow({ sap: 'TOTAL', received: p.totals.received, packed: p.totals.packed, missing: p.totals.missing }); t.font = { bold: true };
  load.addRow({});
  load.addRow({ sap: `Producción por fecha de empaque: ${period} (hora de Ecuador).` });
  load.addRow({ sap: 'Cargar al ERP/SAP la columna "Producción a cargar" (match empaque + bodega). "Falta en bodega" son colchones empacados que todavía no se escanean en bodega.' });

  sheet(wb, 'Detalle etiquetas', [
    { header: 'Etiqueta', key: 'code', width: 18 }, { header: 'Lote', key: 'batch', width: 8 }, { header: 'Código SAP', key: 'sap', width: 14 }, { header: 'Modelo', key: 'model', width: 30 }, { header: 'Medida', key: 'measure', width: 12 },
    { header: 'Empaque', key: 'packed', width: 18 }, { header: 'Empacador', key: 'packer', width: 20 }, { header: 'Empaque manual', key: 'pm', width: 10 },
    { header: 'Bodega', key: 'received', width: 18 }, { header: 'Recibió', key: 'receiver', width: 20 }, { header: 'Bodega manual', key: 'rm', width: 10 }, { header: 'Estado', key: 'status', width: 16 },
  ], p.detail.map(l => ({ code: l.code, batch: l.batch_id, sap: l.sap_code, model: l.model_name, measure: l.measure, packed: fmtDateTime(l.packed_at), packer: l.packed_name, pm: l.packed_manual ? 'Sí' : 'No',
    received: fmtDateTime(l.received_at), receiver: l.received_name, rm: l.received_at ? (l.received_manual ? 'Sí' : 'No') : '', status: l.received_at ? 'Match' : 'Falta en bodega' })));

  sheet(wb, 'Intentos rechazados', [
    { header: 'Fecha y hora', key: 'at', width: 18 }, { header: 'Etapa', key: 'stage', width: 10 }, { header: 'Código leído', key: 'code', width: 20 }, { header: 'Motivo', key: 'result', width: 16 },
    { header: 'SAP esperado', key: 'expected', width: 14 }, { header: 'SAP de la etiqueta', key: 'label', width: 16 }, { header: 'Usuario', key: 'user', width: 20 }, { header: 'Manual', key: 'manual', width: 8 },
  ], p.rejected.map(r => ({ at: fmtDateTime(r.scanned_at), stage: STAGE_LABEL[r.stage], code: r.scanned_code, result: RESULT_LABEL[r.result], expected: r.expected_sap_code, label: r.label_sap_code, user: r.scanned_by_name, manual: r.manual ? 'Sí' : 'No' })));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
