import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
export type SapRow={center:string;alternative:string;material:string;description:string;base_quantity:number|null;base_unit:string|null;position:string|null;component:string;quantity:number|null;unit:string|null;component_alternative:string|null;component_description:string|null;source_row:number;raw_source:unknown[]};
export async function readSapExcel(bytes:Buffer){
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as any);const sheet=book.getWorksheet('Data')??book.worksheets[0];if(!sheet)throw new Error('El Excel no contiene hojas.');
 const columns=['Centro','LMat alternativa','Material','Texto de alternativa','Cantidad base','Unidad medida base','Núm.posición','Componente','Cantidad componente','Un.medida componente','LMat alternativa','Texto breve material'];
 if(columns.some((c,i)=>String(sheet.getRow(1).getCell(i+1).value??'').trim()!==c))throw new Error('Las columnas no coinciden con la exportación SAP esperada. Se distinguen las dos columnas LMat alternativa por su posición.');
 if(sheet.rowCount>50001)throw new Error('Máximo 50.000 posiciones por archivo.');
 const rows:SapRow[]=[];const errors:string[]=[];const warnings:string[]=[];const bases=new Map<string,string>();
 sheet.eachRow((row,index)=>{if(index===1)return;const v=Array.from({length:12},(_,i)=>row.getCell(i+1).value);if(v.every(x=>x===null))return;
  if(v.some(x=>typeof x==='object'&&x!==null)){errors.push(`Fila ${index}: usa valores simples, sin fórmulas.`);return;}
  // SAP identifiers are exact source values. Trimming NBSP merged two distinct
  // exported parents with different bases; preserve them and flag for review.
  const t=(i:number)=>v[i]===null?'':String(v[i]);const num=(i:number)=>v[i]===null||t(i).trim()===''?null:Number(v[i]);
  const r:SapRow={center:t(0),alternative:t(1),material:t(2),description:t(3),base_quantity:num(4),base_unit:t(5)||null,position:t(6)||null,component:t(7),quantity:num(8),unit:t(9)||null,component_alternative:t(10)||null,component_description:t(11)||null,source_row:index,raw_source:v};
  if(!r.center.trim()||!r.material.trim()||!r.alternative.trim()||!r.component.trim())errors.push(`Fila ${index}: falta centro, alternativa o código.`);
  if(r.material!==r.material.trim()||r.component!==r.component.trim())warnings.push(`Fila ${index}: código con espacios periféricos; se conserva exactamente y no se fusiona.`);
  if(r.base_quantity===null||!Number.isFinite(r.base_quantity)||r.base_quantity<=0)errors.push(`Fila ${index}: cantidad base inválida.`);
  if(r.quantity!==null&&!Number.isFinite(r.quantity))errors.push(`Fila ${index}: cantidad inválida.`);
  if(r.quantity===null||!r.unit)warnings.push(`Fila ${index}: cantidad o unidad no informada; no podrá calcularse.`);
  const key=JSON.stringify([r.center,r.material,r.alternative]);const base=JSON.stringify([r.base_quantity,r.base_unit]);if(bases.has(key)&&bases.get(key)!==base)errors.push(`Fila ${index}: base inconsistente dentro del mismo BOM.`);bases.set(key,base);rows.push(r);
 });
 return {rows,errors,warnings,hash:createHash('sha256').update(bytes).digest('hex'),sheet:sheet.name,summary:{rows:rows.length,headers:bases.size,materials:new Set(rows.map(r=>r.component)).size,negative:rows.filter(r=>(r.quantity??0)<0).length,units:[...new Set(rows.map(r=>r.unit))]}};
}
