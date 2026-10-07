import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { areaLoad, hoursPerUnit, inventoryCost, parseCosts, parseInventory, parseRoutings, sapDate, summarizeRoutes, type Operation } from '../src/lib/masters';
import { readFirstSheet } from '../src/lib/planning-excel';
import { buildCalendar, type Area, type DemandItem } from '../src/lib/planning';

const base='BASES DE DATOS LAMITEX/';
const costs=base+'MODULOS COSTOS/costos.xlsx',kardex=base+'MODULO INVENTARIO INICIAL/KARDEX 3016.xlsx',routes=base+'TIEMPOS DE PRODUCCION/HOJAS DE RUTA LAMITEX 16 DE ENERO 2026.xlsx';

test('fechas SAP en varios formatos',()=>{assert.equal(sapDate('11.07.2025'),'2025-07-11');assert.equal(sapDate('2026-01-01'),'2026-01-01');assert.equal(sapDate(null),null);assert.equal(sapDate('ayer'),undefined);});
test('costos: columnas por nombre, precio vacío queda pendiente y repetidos se rechazan',()=>{
 const r=parseCosts([['Precio','Material','Texto breve material'],[10.5,'A','Uno'],[null,'B','Dos'],[3,'A','Otra vez']]);
 assert.equal(r.rows.length,2);assert.equal(r.rows[1].price,null);assert.equal(r.errors.length,1);assert.ok(r.warnings.some(w=>w.includes('sin precio')));
});
test('costo de inventario usa el % propio o el general',()=>{assert.equal(inventoryCost(100,null,1),1);assert.equal(inventoryCost(100,2.5,1),2.5);assert.equal(inventoryCost(null,2,1),null);});
test('hojas de ruta: tiempo por unidad divide por cantidad base y convierte minutos',()=>{
 assert.equal(hoursPerUnit({standard_value:0.18,standard_unit:'H',base_quantity:1}),0.18);
 assert.equal(hoursPerUnit({standard_value:30,standard_unit:'MIN',base_quantity:2}),0.25);
 const r=parseRoutings([['Centro','Material\t','Número de operación','Valor prefijado','Unidad de medida valor prefijado','Puesto de trabajo','Contador grupo hojas ruta'],['3001','X1 ','10',0.5,'H','LACRTA01','1'],['','','','','','',''],[null,null,null,null,null,null,null]]);
 assert.deepEqual(r.errors,[]);assert.equal(r.rows[0].material_code,'X1');assert.equal(r.rows[0].operation,'0010');
});
test('carga de áreas: demanda × horas por puesto contra horas-persona disponibles',()=>{
 const ops:Operation[]=[{id:1,material_code:'M',route_counter:'1',operation:'0010',center:null,route_description:'M',control_key:null,base_quantity:1,op_unit:'UN',standard_value:0.5,standard_unit:'H',operation_text:'TAPIZADO',work_center:'TA',active:true},{id:2,material_code:'M',route_counter:'1',operation:'0020',center:null,route_description:'M',control_key:null,base_quantity:1,op_unit:'UN',standard_value:0.25,standard_unit:'H',operation_text:'EMPACADO',work_center:'EM',active:true}];
 const s=summarizeRoutes(ops);assert.equal(s.get('M')!.hours,0.75);
 const area:Area={id:1,name:'TAPICERÍA',headcount:2,default_attendance_pct:50,limits_capacity:true,active:true,notes:null,sort:1};
 const cal=buildCalendar('2026-10',[1,2,3,4,5,6,7].map(w=>({weekday:w,is_working:w<6,start_time:'07:00',end_time:'17:00',break_minutes:60,ordinary_hours:8})),[],[area],[],[]);
 const item:DemandItem={material_code:'M',description:'M',mattress_type:'T',panel_type:'NP',size_cm:135,monthly_demand:100,active:true};
 const l=areaLoad([item,{...item,material_code:'Z'}],s,[{code:'TA',name:'TAPIZADO',area_id:1,notes:null}],[area],cal);
 const tap=l.rows.find(r=>r.area?.id===1)!;assert.equal(tap.required,50);assert.equal(tap.available,22*9*2*0.5);
 assert.equal(l.rows.find(r=>!r.area)!.required,25);assert.equal(l.missing.length,1);
});
test('Excel real de costos',{skip:!existsSync(costs)},async()=>{const {rows}=await readFirstSheet(await readFile(costs),10);const r=parseCosts(rows);assert.deepEqual(r.errors,[]);assert.equal(r.rows.length,4655);assert.equal(r.rows.find(x=>x.material_code==='3C80595')!.price,49.763565);assert.equal(r.rows.find(x=>x.material_code==='3C80595')!.price_updated_at,'2026-01-01');});
test('Excel real del Kardex 3016',{skip:!existsSync(kardex)},async()=>{const {rows}=await readFirstSheet(await readFile(kardex),11);const r=parseInventory(rows);assert.deepEqual(r.errors,[]);assert.equal(r.rows.length,5005);assert.equal(r.rows.find(x=>x.material_code==='3C80595')!.free_stock,862);});
test('Excel real de hojas de ruta: ignora la fila de totales y el colchón 3C80595 tiene 5 operaciones',{skip:!existsSync(routes)},async()=>{
 const {rows}=await readFirstSheet(await readFile(routes),13);const r=parseRoutings(rows);assert.deepEqual(r.errors,[]);assert.equal(r.rows.length,4842);
 const s=summarizeRoutes(r.rows.map((o,i)=>({...o,id:i,active:true})));const m=s.get('3C80595')!;assert.equal(m.operations.length,5);assert.ok(m.hours>0.2&&m.hours<1.5);
});
