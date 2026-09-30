import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { directRequirement } from '../src/lib/requirements';
const data=JSON.parse(readFileSync(new URL('../src/data/material-lists.json',import.meta.url),'utf8'));
test('corrected SAP retains every position and separates all center/alternative headers',()=>{
  assert.equal(data.headers.reduce((n:number,h:any)=>n+h.items.length,0),18199);
  assert.equal(new Set(data.headers.map((h:any)=>h.key)).size,2482);
  assert.equal(data.headers.flatMap((h:any)=>h.items).filter((i:any)=>i.quantity<0).length,1561);
  assert.ok(data.headers.every((h:any)=>h.issues.length===0));
});
test('Boreal direct requirements scale source quantities without changing signs or units',()=>{
  const h=data.headers.find((h:any)=>h.material==='3C83010'&&h.center==='3001'&&h.alternative==='1');
  const fabric=h.items.find((i:any)=>i.code==='8T10459');
  assert.equal(fabric.unit,'M2');
  assert.equal(directRequirement(fabric.quantity,h.baseQuantity,10),67.5);
  assert.ok(Math.abs(directRequirement(-.336,2,10)-(-1.68))<1e-12);
  assert.equal(directRequirement(13.5,2,0),0);
  for(const args of [[1,0,10],[1,2,-1],[1,2,Infinity],[NaN,2,1]]) assert.throws(()=>directRequirement(...args as [number,number,number]));
});
