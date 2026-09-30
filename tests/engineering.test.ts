import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { emptyEngineeringBom,validateEngineering,duplicateEngineering,graphNodes,type EngineeringBom } from '../src/lib/engineering';
import { readEngineeringWorkbook,writeEngineeringWorkbook } from '../src/lib/engineering-excel';
function fixture(depth:number):EngineeringBom{return {...emptyEngineeringBom(),design:`Prueba ${depth}`,nodes:Array.from({length:depth},(_,i)=>({key:`N${i+1}`,parentKey:i?`N${i}`:null,externalId:null,name:`Componente ${i+1}`,declaredLevel:i+1,quantity:i+1,unit:null,leadTime:i===0?0.3:null,leadTimeUnit:null,notes:null,active:true,sequence:i+1,sourceFile:null,sourceRow:null}))};}
test('BOM supports 2,3,4,5 and 12 levels without mandatory units or external codes',()=>{for(const d of [2,3,4,5,12]){const r=validateEngineering(fixture(d));assert.ok(r.valid);assert.equal(Math.max(...Object.values(r.levels)),d);assert.ok(r.issues.some(i=>i.code==='MISSING_UOM'));}});
test('declared levels are warning-only; critical structural errors block',()=>{
 const b=fixture(5);b.nodes[4].declaredLevel=2;assert.ok(validateEngineering(b).valid);assert.equal(b.nodes[4].declaredLevel,2);
 b.nodes[0].parentKey='N5';assert.equal(validateEngineering(b).valid,false);
 b.nodes[0].parentKey='foreign';assert.equal(validateEngineering(b).valid,false);
 b.nodes[0].parentKey=null;b.nodes[0].quantity=0;assert.equal(validateEngineering(b).valid,false);
 b.nodes[0].quantity=1;b.nodes[0].active=false;assert.ok(validateEngineering(b).issues.some(i=>i.code==='INACTIVE_PARENT'));
});
test('duplicate is independent while preserving component relationships',()=>{const b=fixture(5);b.id=3;b.revision=4;b.reference='original';const c=duplicateEngineering(b);assert.equal(c.id,null);assert.equal(c.reference,null);c.nodes[0].name='Otra';assert.notEqual(c.nodes[0].name,b.nodes[0].name);assert.deepEqual(graphNodes(c).map(n=>n.parent),[null,1,2,3,4]);});
test('Excel round-trip preserves all designs, parent keys, levels, quantities, optional units and inactive nodes',async()=>{
 const boms=[2,3,4,5,12].map(fixture);boms[0].nodes[1].active=false;boms[1].reference='saved-reference';boms[1].nodes[0].externalId='101';boms[2].nodes[2].declaredLevel=7;
 const parsed=await readEngineeringWorkbook(await writeEngineeringWorkbook(boms),'roundtrip.xlsx');assert.deepEqual(parsed.errors,[]);assert.equal(parsed.boms.length,5);assert.ok(parsed.validation.every(v=>v.valid));
 for(let i=0;i<boms.length;i++)assert.deepEqual(parsed.boms[i].nodes.map(n=>[n.key,n.parentKey,n.name,n.declaredLevel,n.quantity,n.unit,n.leadTime,n.leadTimeUnit,n.active,n.externalId]),boms[i].nodes.map(n=>[n.key,n.parentKey,n.name,n.declaredLevel,n.quantity,n.unit,n.leadTime,n.leadTimeUnit,n.active,n.externalId]));
});
test('one Excel BOM resolves names without mandatory component IDs and rejects ambiguity',async()=>{
 const wb=new ExcelJS.Workbook();wb.addWorksheet('MODELOS').addRows([['design'],['Diseño A']]);const ws=wb.addWorksheet('BOM_ESTRUCTURA');ws.addRows([['design','component_name','parent_component_name','quantity'],['Diseño A','Panel','PRODUCTO TERMINADO',1],['Diseño A','Resorte','Panel',2]]);
 let parsed=await readEngineeringWorkbook(Buffer.from(await wb.xlsx.writeBuffer()),'manual.xlsx');assert.deepEqual(parsed.errors,[]);assert.equal(parsed.boms[0].nodes[1].parentKey,parsed.boms[0].nodes[0].key);
 ws.addRow(['Diseño A','Panel','',1]);parsed=await readEngineeringWorkbook(Buffer.from(await wb.xlsx.writeBuffer()),'ambiguous.xlsx');assert.ok(parsed.errors.some(e=>e.includes('ambiguo')));
});
test('import rejects unknown designs, formulas and cross-BOM parents',async()=>{
 const b=fixture(2);b.nodes[1].parentKey='missing';const p=await readEngineeringWorkbook(await writeEngineeringWorkbook([b]),'bad.xlsx');assert.equal(p.validation[0].valid,false);
 const wb=new ExcelJS.Workbook();wb.addWorksheet('MODELOS').addRows([['design'],['A']]);wb.addWorksheet('BOM_ESTRUCTURA').addRows([['design','component_name','quantity'],['B','Panel',{formula:'1+1',result:2}]]);const r=await readEngineeringWorkbook(Buffer.from(await wb.xlsx.writeBuffer()),'formula.xlsx');assert.ok(r.errors.length>=2);
});
