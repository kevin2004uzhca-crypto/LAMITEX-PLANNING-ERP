import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBom, unitUsage, cumulativeUsage, type BomNode } from '../src/lib/bom';
const pilot=JSON.parse(readFileSync(new URL('../src/data/pilot.json',import.meta.url),'utf8'));
const fixture=():BomNode[]=>structuredClone(pilot.nodes);
test('BOM 101 preserves all ten source rows and exact expected topology',()=>{
 const rows=fixture(); const r=validateBom(rows); assert.equal(r.valid,true);
 assert.deepEqual(rows.map(n=>n.parent),[null,null,null,1,1,1,1,5,5,5]);
 assert.deepEqual(rows.map(n=>r.levels[n.id]),[1,1,1,2,2,2,2,3,3,3]);
 assert.deepEqual(r.paths[8],[1,5,8]);assert.deepEqual(rows.map(n=>n.quantity),[1,1,2,2,1,2,2,1,2,2]);
 assert.equal(rows[6].name,'Latex F + Convoluted Foam + Latex F');
 assert.deepEqual(rows.map(n=>n.sourceRow),[2,3,4,5,6,7,8,9,10,11]);
 assert.equal(r.issues.filter(i=>i.code==='MISSING_UOM').length,10);
});
test('cycles, missing roots and disconnected nodes are rejected',()=>{
 const rows=fixture();rows[0].parent=5;const r=validateBom(rows);assert.equal(r.valid,false);assert.ok(r.issues.some(i=>i.code==='CYCLE'));assert.ok(r.issues.some(i=>i.code==='DISCONNECTED_NODE'));
});
test('parents are never resolved across BOM boundaries',()=>{
 const rows=fixture();rows[4].bom='another-bom';const r=validateBom(rows);assert.equal(r.valid,false);assert.ok(r.issues.some(i=>i.code==='CROSS_BOM_PARENT'));assert.equal(r.paths[8],undefined);
});
test('missing parent, duplicate ids and self-parent are detected',()=>{
 const rows=fixture();rows[0].parent=999;rows[1].parent=2;rows.push({...rows[0]});const r=validateBom(rows);for(const code of ['MISSING_PARENT','DUPLICATE_NODE','SELF_PARENT'])assert.ok(r.issues.some(i=>i.code===code));
});
test('zero and missing quantities, negative lead time and level mismatch fail',()=>{
 const rows=fixture();rows[0].quantity=0;rows[1].quantity=null;rows[2].leadTime=-1;rows[3].declaredLevel=7;const r=validateBom(rows);assert.equal(r.valid,false);for(const code of ['INVALID_QUANTITY','INVALID_LEAD_TIME','LEVEL_MISMATCH'])assert.ok(r.issues.some(i=>i.code===code));
});
test('arbitrary depths work without a fixed three-level assumption',()=>{
 const rows:BomNode[]=Array.from({length:200},(_,i)=>({...fixture()[0],id:i+1,parent:i===0?null:i,declaredLevel:i+1}));const r=validateBom(rows);assert.equal(r.valid,true);assert.equal(r.levels[200],200);
});
test('SAP preserves negative signs and multiplies factors along a route',()=>{
 assert.equal(unitUsage(-.336,2),-.168);assert.equal(cumulativeUsage([2,.5,3]),3);assert.throws(()=>unitUsage(1,0));assert.throws(()=>unitUsage(1,-2));
});
test('pilot SAP keeps all 19 direct records and its explicit alternative',()=>{
 assert.equal(pilot.sapHeaders.length,1);const h=pilot.sapHeaders[0];assert.equal(h.alternative,'1');assert.equal(h.center,'3001');assert.equal(h.baseQuantity,2);assert.equal(h.items.length,19);for(const i of h.items)assert.equal(i.unitUsage,unitUsage(i.quantity,h.baseQuantity));
});
