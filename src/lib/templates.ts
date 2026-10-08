import ExcelJS from 'exceljs';
import { COST_COLUMNS, INVENTORY_COLUMNS, ROUTING_COLUMNS } from './masters';
import { SAP_COLUMNS } from './sap-excel';

/** Plantillas vacías para las cargas masivas: mismas columnas que lee cada importador, más una hoja de instrucciones. */
export const TEMPLATE_KINDS = ['COSTOS', 'INVENTARIO', 'RUTAS', 'SAP', 'ENTRENAMIENTO', 'PRODUCCION'] as const;
export type TemplateKind = typeof TEMPLATE_KINDS[number];
const PROGRAM_COLUMNS = ['Material', 'Descripción del material', 'Cantidad'];

type Def = { file: string; sheets: string[]; columns: string[]; example: (string | number)[]; notes: string[] };
const DEFS: Record<TemplateKind, Def> = {
  COSTOS: { file: 'PLANTILLA_COSTOS', sheets: ['Costos'], columns: COST_COLUMNS, example: ['3C45327', '1000', '7920', 'COLCHON EJEMPLO 135X190', '2026-10-01', 'FERT', 'COLCHONES', 'UN', 125.5, 'USD'],
    notes: ['Una fila por material y centro, como la exporta SAP.', 'Obligatorias: Material, Texto breve material y Precio (sin precio queda pendiente).', 'Moneda vacía se toma como USD.'] },
  INVENTARIO: { file: 'PLANTILLA_INVENTARIO', sheets: ['Inventario'], columns: INVENTORY_COLUMNS, example: ['3C45327', 'COLCHON EJEMPLO 135X190', '1000', '1100', 'UN', 42, 'BODEGA PT', 'COLCHONES', 0, 5271, ''],
    notes: ['Una fila por material y almacén, como la exporta SAP (MB52).', 'Obligatorias: Material, Texto breve material y Libre utilización.', 'El stock negativo se conserva tal como viene de SAP.'] },
  RUTAS: { file: 'PLANTILLA_TIEMPOS_RUTAS', sheets: ['Rutas'], columns: ROUTING_COLUMNS, example: ['1000', '3C45327', 'COLCHON EJEMPLO', '0010', 'PP01', 1, 'UN', 0.35, 'H', 'ACOLCHADO', 'ACOLCH01', '1'],
    notes: ['Una fila por operación de la hoja de ruta, como la exporta SAP (CA03).', 'Obligatorias: Material, Número de operación y Valor prefijado.', 'Unidad del valor prefijado: H, MIN o S.'] },
  SAP: { file: 'PLANTILLA_LISTAS_SAP', sheets: ['Data'], columns: SAP_COLUMNS, example: ['1000', '1', '3C45327', 'COLCHON EJEMPLO', 1, 'UN', '0010', '1M00123', 2.5, 'M2', '', 'TELA EJEMPLO'],
    notes: ['Exportación de listas de materiales SAP (CS12 / CS11), una fila por componente.', 'Las columnas deben quedar en este orden exacto; las dos "LMat alternativa" se distinguen por su posición.', 'Sin fórmulas: solo valores.'] },
  ENTRENAMIENTO: { file: 'PLANTILLA_ENTRENAMIENTO', sheets: ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'], columns: PROGRAM_COLUMNS, example: ['3C45327', 'COLCHON EJEMPLO 135X190', 20],
    notes: ['Cada hoja es un programa diario; el día se reconoce por el nombre de la hoja (LUNES, MARTES…). Borra las hojas que no uses.', 'Columnas: Material (código SAP) · Descripción · Cantidad (tercera columna).', 'Si un material se repite en la misma hoja, se suman las cantidades.'] },
  PRODUCCION: { file: 'PLANTILLA_PRODUCCION_REAL', sheets: ['PROGRAMA'], columns: PROGRAM_COLUMNS, example: ['3C45327', 'COLCHON EJEMPLO 135X190', 20],
    notes: ['Programa que de verdad se mandó a producir un día: código SAP y cantidad.', 'Una hoja = un día. Si nombras las hojas LUNES, MARTES…, cada una se guarda en su fecha de la semana que elijas en el ERP.', 'Mismo formato que Entrenamiento: Material · Descripción · Cantidad (tercera columna).'] },
};

export async function templateWorkbook(kind: TemplateKind) {
  const d = DEFS[kind]; const book = new ExcelJS.Workbook(); book.creator = 'LAMITEX Planning ERP';
  for (const name of d.sheets) {
    const ws = book.addWorksheet(name);
    ws.columns = d.columns.map(h => ({ header: h, width: Math.max(12, Math.min(40, h.length + 6)) }));
    const r = ws.getRow(1); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C6975' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const ins = book.addWorksheet('INSTRUCCIONES');
  ins.columns = [{ width: 28 }, ...d.columns.slice(1).map(() => ({ width: 18 }))];
  ins.addRow(['Cómo llenar esta plantilla']).font = { bold: true, size: 14, color: { argb: 'FF2C6975' } };
  for (const n of d.notes) ins.addRow([`• ${n}`]);
  ins.addRow(['• Llena desde la fila 2 de la hoja de datos; no cambies ni muevas los encabezados.']);
  ins.addRow([]); ins.addRow(['Ejemplo de una fila (no se importa):']).font = { bold: true };
  ins.addRow(d.columns).font = { bold: true }; ins.addRow(d.example);
  return { buffer: Buffer.from(await book.xlsx.writeBuffer()), name: `${d.file}.xlsx` };
}
