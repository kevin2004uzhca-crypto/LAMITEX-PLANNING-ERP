import { validateBom, sourceSheetFromNotes, type BomNode } from './bom';
export function visibleNotes(notes:string|null){try{const p=JSON.parse(notes??'null');if(p&&typeof p==='object'&&'source_sheet' in p)return typeof p.comment==='string'?p.comment:null;}catch{}return notes;}
export function editNotes(original:string|null,value:string){try{const p=JSON.parse(original??'null');if(p&&typeof p==='object'&&'source_sheet' in p)return JSON.stringify({...p,comment:value||null});}catch{}return value||null;}
export type EngineeringNode={key:string; parentKey:string|null; externalId:string|null; name:string; declaredLevel:number|null; quantity:number|null; unit:string|null; leadTime:number|null; leadTimeUnit:string|null; notes:string|null; active:boolean; sequence:number; sourceFile:string|null; sourceRow:number|null};
export type EngineeringBom={id:number|null; revision:number|null; reference:string|null; design:string; referenceCode:string|null; brand:string|null; description:string|null; imagePath:string|null; notes:string|null; lifecycle:'ACTIVE'|'INACTIVE'|'ARCHIVED'; sourceType:'MANUAL'|'EXCEL_IMPORT'|'LEGACY_IMPORT'; sourceFile:string|null; nodes:EngineeringNode[]};
export const canEditBom=(role:string)=>['ADMIN','ENGINEERING'].includes(role);
export function graphNodes(bom:EngineeringBom,includeInactive=false):BomNode[]{
 const ids=new Map(bom.nodes.map((n,i)=>[n.key,i+1]));
 return bom.nodes.filter(n=>includeInactive||n.active).map(n=>({id:ids.get(n.key)!,bom:String(bom.id??'preview'),name:n.name,parent:n.parentKey===null?null:ids.get(n.parentKey)??-1,declaredLevel:n.declaredLevel,quantity:n.quantity,unit:n.unit,leadTime:n.leadTime,leadTimeUnit:n.leadTimeUnit,notes:visibleNotes(n.notes),externalId:n.externalId,sourceFile:n.sourceFile??(bom.sourceType==='MANUAL'?'Editor administrativo':'No informada'),sourceSheet:sourceSheetFromNotes(n.notes)!=='No informada'?sourceSheetFromNotes(n.notes):bom.sourceType==='EXCEL_IMPORT'?'BOM_ESTRUCTURA':'No informada',sourceRow:n.sourceRow??0,sequence:n.sequence}));
}
export function validateEngineering(bom:EngineeringBom){
 const report=validateBom(graphNodes(bom,true));
 const issues=[...report.issues];
 const error=(code:string,message:string)=>issues.push({code,message,node:null,severity:'ERROR'});
 if(!bom.design?.trim())error('DESIGN','El diseño es obligatorio.');
 if(!['ACTIVE','INACTIVE','ARCHIVED'].includes(bom.lifecycle))error('STATUS','Estado inválido.');
 if(!bom.referenceCode)issues.push({code:'MISSING_CODE',message:'Código externo no informado.',node:null,severity:'WARNING'});
 if(bom.nodes.length<1||bom.nodes.length>2000)error('SIZE','Se requieren entre 1 y 2.000 componentes por BOM.');
 const keys=new Set<string>();const external=new Set<string>();
 for(const n of bom.nodes){
  if(!n.key||keys.has(n.key))error('DUPLICATE_NODE','Identificador de componente repetido o vacío.');keys.add(n.key);
  if(n.externalId&&external.has(n.externalId))error('DUPLICATE_EXTERNAL','Código histórico repetido en el BOM.');if(n.externalId)external.add(n.externalId);
  if(!n.name?.trim())error('NAME','Nombre de componente obligatorio.');
  if(n.declaredLevel!==null&&(!Number.isInteger(n.declaredLevel)||n.declaredLevel<1))error('LEVEL','El nivel debe ser un entero positivo o quedar vacío.');
  if(n.active&&n.parentKey&&bom.nodes.find(p=>p.key===n.parentKey)?.active===false)error('INACTIVE_PARENT',`${n.name} depende de un padre inactivo.`);
 }
 return {...report,issues,valid:!issues.some(i=>i.severity==='ERROR')};
}
export function emptyEngineeringBom():EngineeringBom{return {id:null,revision:null,reference:null,design:'',referenceCode:null,brand:null,description:null,imagePath:null,notes:null,lifecycle:'ACTIVE',sourceType:'MANUAL',sourceFile:null,nodes:[]};}
export function duplicateEngineering(b:EngineeringBom):EngineeringBom{return {...structuredClone(b),id:null,revision:null,reference:null,design:`${b.design} · copia`,referenceCode:null,lifecycle:'ACTIVE',sourceType:'MANUAL'};}
