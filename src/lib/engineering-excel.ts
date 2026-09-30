import ExcelJS from 'exceljs';
import { emptyEngineeringBom,validateEngineering,type EngineeringBom } from './engineering';
const modelColumns=['design','reference_code','brand','description','image_reference','status','notes','bom_reference'];
const nodeColumns=['design','bom_reference','component_id','component_name','parent_component_id','parent_component_name','level','quantity','lead_time','notes','active','unit','lead_time_unit','external_component_id','source_file','source_row'];
const text=(v:unknown)=>v===null||v===undefined?'':String(v).trim();
const number=(v:unknown)=>text(v)===''?null:Number(v);
export async function writeEngineeringWorkbook(boms:EngineeringBom[]){
 const wb=new ExcelJS.Workbook();wb.creator='LAMITEX Planning ERP';
 const models=wb.addWorksheet('MODELOS');const nodes=wb.addWorksheet('BOM_ESTRUCTURA');const instructions=wb.addWorksheet('INSTRUCCIONES');
 models.addRow(modelColumns);nodes.addRow(nodeColumns);
 for(const b of boms){
  models.addRow([b.design,b.referenceCode,b.brand,b.description,b.imagePath,b.lifecycle,b.notes,b.reference]);
  for(const n of b.nodes)nodes.addRow([b.design,b.reference,n.key,n.name,n.parentKey,b.nodes.find(p=>p.key===n.parentKey)?.name??'PRODUCTO TERMINADO',n.declaredLevel,n.quantity,n.leadTime,n.notes,n.active,n.unit,n.leadTimeUnit,n.externalId,n.sourceFile,n.sourceRow]);
 }
 instructions.addRows([
 ['Campo / acción','Instrucción'],['Formato','Un solo libro sirve para uno o varios diseños. No combinar celdas.'],
 ['MODELOS','design obligatorio; código, marca, descripción e imagen son opcionales. Una fila por BOM.'],
 ['BOM_ESTRUCTURA','design, component_name y quantity son obligatorios. quantity debe ser mayor que cero.'],
 ['Padres','Indique parent_component_id o un parent_component_name inequívoco dentro del mismo diseño y BOM. Raíz: vacío o PRODUCTO TERMINADO.'],
 ['IDs','component_id puede quedar vacío; se genera internamente. Si hay nombres repetidos, use IDs para identificar el padre.'],
 ['bom_reference','Conserve la referencia exportada para actualizar el mismo BOM. Si cambia el diseño se creará uno nuevo. Para varias estructuras del mismo diseño use referencias distintas.'],
 ['Estados','status: ACTIVE, INACTIVE o ARCHIVED. active: TRUE/FALSE. Un padre inactivo no puede tener hijos activos.'],
 ['Unidades','unit y lead_time_unit son opcionales. No se asumen unidades ausentes.'],
 ['Nivel','Se conserva el declarado. Una diferencia con el calculado es advertencia; no se modifica silenciosamente.'],
 ['Imágenes','image_reference es una ruta ya existente en el almacenamiento privado del ERP; suba nuevas imágenes desde Gestión de BOM.'],
 ['Seguridad','No use fórmulas en las celdas de datos. No se evalúan macros ni se descargan imágenes externas.'],
 ['Confirmación','Siempre revise el resumen, las advertencias y cada árbol antes de confirmar. PostgreSQL es la fuente oficial.']]);
 for(const ws of [models,nodes,instructions]){
  ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,ws.rowCount),column:ws.columnCount}};
  ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2C6975'}};ws.getRow(1).height=30;
  ws.columns.forEach((c,i)=>{c.width=ws===instructions?(i===0?24:105):([0,3,5].includes(i)?35:22);});
  ws.eachRow((r,i)=>{if(i>1){r.alignment={vertical:'top',wrapText:true};r.font={color:{argb:'FF204D57'}};}});
 }
 return Buffer.from(await wb.xlsx.writeBuffer());
}
export async function readEngineeringWorkbook(bytes:Buffer,fileName:string){
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes as any);
 const errors:string[]=[];
 function records(sheet:string,required:string[]){
  const ws=wb.getWorksheet(sheet);if(!ws){errors.push(`Falta hoja ${sheet}.`);return [];}
  if(ws.rowCount>20001){errors.push(`${sheet}: máximo 20.000 filas.`);return [];}
  const header=(ws.getRow(1).values as any[]).slice(1).map(text);
  if(required.some(c=>!header.includes(c)))errors.push(`${sheet}: faltan columnas ${required.filter(c=>!header.includes(c)).join(', ')}.`);
  if(new Set(header.filter(Boolean)).size!==header.filter(Boolean).length)errors.push(`${sheet}: encabezados repetidos.`);
  const rows:Record<string,any>[]=[];
  ws.eachRow((r,index)=>{if(index===1)return;const rec:Record<string,any>={_row:index};let has=false;
   header.forEach((col,i)=>{if(!col)return;const v=r.getCell(i+1).value;if(v!==null)has=true;if(typeof v==='object'&&v!==null){errors.push(`${sheet}, fila ${index}: use valores simples, sin fórmulas ni objetos.`);rec[col]='';}else rec[col]=v;});if(has)rows.push(rec);
  });return rows;
 }
 const models=records('MODELOS',['design']);const structures=records('BOM_ESTRUCTURA',['design','component_name','quantity']);
 const boms:EngineeringBom[]=[];const consumed=new Set<number>();const identities=new Set<string>();
 for(const m of models){
  const name=text(m.design),ref=text(m.bom_reference);const identity=JSON.stringify([name,ref]);
  if(!name){errors.push(`MODELOS fila ${m._row}: diseño vacío.`);continue;}if(identities.has(identity)){errors.push(`Diseño/BOM repetido: ${name}.`);continue;}identities.add(identity);
  const raw=structures.filter(r=>text(r.design)===name&&(text(r.bom_reference)===ref || (!text(r.bom_reference)&&models.filter(x=>text(x.design)===name).length===1)));
  const reserved=new Set(raw.map(r=>text(r.component_id)).filter(Boolean));const keys=raw.map((r,i)=>{if(text(r.component_id))return text(r.component_id);let k=`N${String(i+1).padStart(4,'0')}`;while(reserved.has(k))k=`_${k}`;reserved.add(k);return k;});
  const bom:EngineeringBom={...emptyEngineeringBom(),design:name,reference:ref||null,referenceCode:text(m.reference_code)||null,brand:text(m.brand)||null,description:text(m.description)||null,imagePath:text(m.image_reference)||null,notes:text(m.notes)||null,lifecycle:(text(m.status)||'ACTIVE') as EngineeringBom['lifecycle'],sourceType:'EXCEL_IMPORT',sourceFile:fileName};
  bom.nodes=raw.map((r,i)=>{
   consumed.add(r._row);let parent=text(r.parent_component_id)||null;const parentName=text(r.parent_component_name);
   if(!parent&&parentName&&parentName!=='PRODUCTO TERMINADO'){
    const matches=raw.map((x,j)=>({x,j})).filter(({x})=>text(x.component_name)===parentName);
    if(matches.length!==1)errors.push(`${name}, fila ${r._row}: padre «${parentName}» ${matches.length?'ambiguo':'inexistente'}.`);else parent=keys[matches[0].j];
   }else if(parent&&parentName){const p=raw.find((_,j)=>keys[j]===parent);if(p&&text(p.component_name)!==parentName)errors.push(`${name}, fila ${r._row}: ID y nombre del padre no coinciden.`);}
   const active=text(r.active).toLowerCase();if(active&&!['true','false','1','0','sí','si','no'].includes(active))errors.push(`${name}, fila ${r._row}: active inválido.`);
   return {key:keys[i],parentKey:parent,externalId:text(r.external_component_id)||((!Object.hasOwn(r,'external_component_id')&&text(r.component_id))?text(r.component_id):null),name:text(r.component_name),declaredLevel:number(r.level),quantity:number(r.quantity),unit:text(r.unit)||null,leadTime:number(r.lead_time),leadTimeUnit:text(r.lead_time_unit)||null,notes:text(r.notes)||null,active:!['false','0','no'].includes(active),sequence:i+1,sourceFile:text(r.source_file)||fileName,sourceRow:number(r.source_row)??r._row};
  });boms.push(bom);
 }
 for(const r of structures)if(!consumed.has(r._row))errors.push(`BOM_ESTRUCTURA fila ${r._row}: diseño o referencia no existe inequívocamente en MODELOS.`);
 if(!boms.length)errors.push('El archivo no contiene diseños.');
 if(boms.length>200)errors.push('Máximo 200 BOM por carga.');
 return {boms,errors,validation:boms.map(validateEngineering)};
}
