import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { groupCatalog, groupsOf } from '../src/lib/planning-groups';
import { TEMPLATE_KINDS, templateWorkbook } from '../src/lib/templates';
import { readFirstSheet, readTrainingExcel } from '../src/lib/planning-excel';
import { parseCosts, parseInventory, parseRoutings, COST_COLUMNS } from '../src/lib/masters';
import type { PlanningCode, Restriction } from '../src/lib/planning';

const codes: PlanningCode[] = [{ kind: 'COLCHON', code: 'CAJA', name: 'de caja', active: true, sort: 1 }, { kind: 'COLCHON', code: 'PILOTO', name: 'piloto', active: true, sort: 2 }, { kind: 'PANEL', code: 'JUMBO', name: 'jumbo', active: true, sort: 1 }];
const restrictions: Restriction[] = [
  { id: 1, name: 'Colchones de caja', applies_to: 'COLCHON', codes: ['CAJA'], sizes: null, max_per_day: 120, active: true, notes: null, sort: 1 },
  { id: 2, name: 'Paneles jumbo 160-200', applies_to: 'PANEL', codes: ['JUMBO'], sizes: [160, 200], max_per_day: 40, active: true, notes: null, sort: 2 },
  { id: 3, name: 'Inactiva', applies_to: 'COLCHON', codes: ['CAJA'], sizes: null, max_per_day: 1, active: false, notes: null, sort: 3 },
];

test('cada código SAP cae en su tipo y en los grupos de Restricciones que le aplican', () => {
  assert.deepEqual(groupCatalog(codes, restrictions).map(g => g.key), ['C:CAJA', 'C:PILOTO', 'P:JUMBO', 'R:1', 'R:2']);
  assert.deepEqual(groupsOf({ mattress_type: 'CAJA', panel_type: 'JUMBO', size_cm: 160 }, restrictions), ['C:CAJA', 'P:JUMBO', 'R:1', 'R:2']);
  assert.deepEqual(groupsOf({ mattress_type: 'PILOTO', panel_type: 'JUMBO', size_cm: 135 }, restrictions), ['C:PILOTO', 'P:JUMBO']);
  assert.deepEqual(groupsOf(undefined, restrictions), []);
});

test('las plantillas traen exactamente las columnas que lee cada carga masiva', async () => {
  for (const kind of TEMPLATE_KINDS) {
    const { buffer, name } = await templateWorkbook(kind);
    assert.match(name, /^PLANTILLA_.+\.xlsx$/);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as any);
    assert.equal(book.worksheets.at(-1)?.name, 'INSTRUCCIONES');
  }
  // Costos: la plantilla con una fila llenada se valida sin errores.
  const { buffer } = await templateWorkbook('COSTOS');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as any);
  book.worksheets[0].addRow(['3C45327', '1000', '7920', 'COLCHON EJEMPLO', '2026-10-01', 'FERT', 'COLCHONES', 'UN', 125.5, 'USD']);
  const filled = Buffer.from(await book.xlsx.writeBuffer());
  const { rows } = await readFirstSheet(filled, COST_COLUMNS.length);
  const parsed = parseCosts(rows);
  assert.equal(parsed.errors.length, 0); assert.equal(parsed.rows[0].price, 125.5);
  for (const [kind, parse] of [['INVENTARIO', parseInventory], ['RUTAS', parseRoutings]] as const) {
    const t = await templateWorkbook(kind); const r = await readFirstSheet(t.buffer, 12);
    assert.equal(parse(r.rows).errors.filter(e => /columna/i.test(e)).length, 0, kind);
  }
});

test('el programa real y el de entrenamiento se leen de la plantilla, sin la hoja de instrucciones', async () => {
  const { buffer } = await templateWorkbook('PRODUCCION');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as any);
  book.getWorksheet('PROGRAMA')!.addRow(['3C45327', 'COLCHON EJEMPLO', 20]);
  book.getWorksheet('PROGRAMA')!.addRow(['3C45527', 'OTRO', 15]);
  const parsed = await readTrainingExcel(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(parsed.programs.length, 1);
  assert.deepEqual(parsed.programs[0].lines.map(l => [l.material_code, l.quantity]), [['3C45327', 20], ['3C45527', 15]]);
  const training = await readTrainingExcel((await templateWorkbook('ENTRENAMIENTO')).buffer);
  assert.deepEqual(training.programs.map(p => p.weekday), ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']);
});
