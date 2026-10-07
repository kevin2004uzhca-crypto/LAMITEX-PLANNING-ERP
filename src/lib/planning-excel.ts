import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { cellValue, DEMAND_COLUMNS, parseDemandRows, parseProgramSheet, type PlanningCode } from './planning';

export const fileHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

export function sheetRows(sheet:ExcelJS.Worksheet,cols:number){
 const rows:(string|number|null)[][]=[];
 for(let i=1;i<=Math.min(sheet.rowCount,20001);i++){const row=sheet.getRow(i);rows.push(Array.from({length:cols},(_,c)=>cellValue(row.getCell(c+1).value)));}
 return rows;
}
async function load(bytes:Buffer){const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as any);if(!book.worksheets.length)throw new Error('El Excel no contiene hojas.');return book;}

/** Primera hoja visible de un Excel exportado de SAP, como matriz de valores simples. */
export async function readFirstSheet(bytes:Buffer,cols:number,maxRows=100001){
 const book=await load(bytes);const sheet=book.worksheets.find(s=>s.state==='visible'&&s.rowCount>0)??book.worksheets[0];
 if(sheet.rowCount>maxRows)throw new Error(`Máximo ${maxRows-1} filas por archivo.`);
 const rows:(string|number|null)[][]=[];for(let i=1;i<=sheet.rowCount;i++){const row=sheet.getRow(i);rows.push(Array.from({length:Math.max(cols,row.cellCount)},(_,c)=>cellValue(row.getCell(c+1).value)));}
 return {rows,sheet:sheet.name,hash:fileHash(bytes)};
}

export async function readDemandExcel(bytes:Buffer,codes:PlanningCode[]){
 const book=await load(bytes);const sheet=book.worksheets.find(s=>s.state==='visible'&&s.rowCount>0)??book.worksheets[0];
 if(sheet.rowCount>20001)throw new Error('Máximo 20.000 filas por archivo.');
 return {...parseDemandRows(sheetRows(sheet,6),codes),sheet:sheet.name,hash:fileHash(bytes)};
}

export async function readTrainingExcel(bytes:Buffer){
 const book=await load(bytes);if(book.worksheets.length>60)throw new Error('Máximo 60 hojas por archivo.');
 return {programs:book.worksheets.filter(s=>s.state==='visible'&&s.rowCount>0).map(s=>parseProgramSheet(s.name,sheetRows(s,3))),hash:fileHash(bytes)};
}

type Snapshot={material_code:string;description:string;mattress_type:string;panel_type:string;size_cm:number|null;monthly_demand:number;active:boolean};
type HistoryRow=Snapshot&{source:string;changed_at:string};
const header=(ws:ExcelJS.Worksheet)=>{const r=ws.getRow(1);r.font={bold:true,color:{argb:'FFFFFFFF'}};r.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2C6975'}};ws.views=[{state:'frozen',ySplit:1}];};
const fmt=(iso:string)=>new Date(iso).toLocaleString('es-EC',{timeZone:'America/Guayaquil'});

/** Reporte de demanda: estado a la fecha final, comparación contra la fecha inicial y cambios del periodo. */
export async function demandReport(from:string,to:string,atFrom:Snapshot[],atTo:Snapshot[],changes:HistoryRow[]){
 const book=new ExcelJS.Workbook();book.creator='LAMITEX Planning ERP';
 const s1=book.addWorksheet(`Demanda al ${to}`);
 s1.columns=[...DEMAND_COLUMNS.map((h,i)=>({header:h,width:[14,46,16,15,10,22][i]})),{header:'ESTADO',width:12}];
 for(const r of atTo.filter(r=>r.active).sort((a,b)=>Number(b.monthly_demand)-Number(a.monthly_demand)))s1.addRow([r.material_code,r.description,r.mattress_type,r.panel_type,r.size_cm===null?null:Number(r.size_cm),Number(r.monthly_demand),'ACTIVO']);
 for(const r of atTo.filter(r=>!r.active))s1.addRow([r.material_code,r.description,r.mattress_type,r.panel_type,r.size_cm===null?null:Number(r.size_cm),Number(r.monthly_demand),'INACTIVO']);
 header(s1);
 const s2=book.addWorksheet('Comparación');
 s2.columns=[{header:'Material',width:14},{header:'Descripción del material',width:46},{header:`Demanda al ${from}`,width:18},{header:`Demanda al ${to}`,width:18},{header:'Diferencia',width:12},{header:`Tipo al ${from}`,width:14},{header:`Tipo al ${to}`,width:14}];
 const before=new Map(atFrom.map(r=>[r.material_code,r]));const codes=new Set([...atFrom.map(r=>r.material_code),...atTo.map(r=>r.material_code)]);
 const after=new Map(atTo.map(r=>[r.material_code,r]));
 for(const code of [...codes].sort()){const a=before.get(code),b=after.get(code);const va=a&&a.active?Number(a.monthly_demand):0,vb=b&&b.active?Number(b.monthly_demand):0;
  s2.addRow([code,(b??a)!.description,a?va:null,b?vb:null,vb-va,a?`${a.mattress_type}/${a.panel_type}`:'—',b?`${b.mattress_type}/${b.panel_type}`:'—']);}
 header(s2);
 const s3=book.addWorksheet('Cambios del periodo');
 s3.columns=[{header:'Fecha y hora',width:22},{header:'Origen',width:15},{header:'Material',width:14},{header:'Descripción del material',width:46},{header:'TIPO DE COLCHON',width:16},{header:'TIPO DE PANEL',width:15},{header:'MEDIDA',width:10},{header:'PROMEDIO VENTA MENSUAL VOLUMEN',width:22},{header:'Activo',width:9}];
 for(const c of changes)s3.addRow([fmt(c.changed_at),c.source==='CARGA_MASIVA'?'Carga masiva':'Edición manual',c.material_code,c.description,c.mattress_type,c.panel_type,c.size_cm===null?null:Number(c.size_cm),Number(c.monthly_demand),c.active?'Sí':'No']);
 header(s3);
 return Buffer.from(await book.xlsx.writeBuffer());
}

/** Plantilla vacía con las mismas columnas del Excel DEMANDAS.LAMITEX, o con la demanda vigente. */
export async function demandTemplate(rows:Snapshot[]){
 const book=new ExcelJS.Workbook();const ws=book.addWorksheet('Demanda');
 ws.columns=DEMAND_COLUMNS.map((h,i)=>({header:h,width:[14,46,16,15,10,22][i]}));
 for(const r of rows)ws.addRow([r.material_code,r.description,r.mattress_type,r.panel_type,r.size_cm===null?null:Number(r.size_cm),Number(r.monthly_demand)]);
 header(ws);return Buffer.from(await book.xlsx.writeBuffer());
}
