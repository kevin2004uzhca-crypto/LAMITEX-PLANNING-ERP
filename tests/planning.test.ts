import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { buildCalendar, capacitySummary, checkProgram, diffDemand, matchesRestriction, netHours, parseDemandRows, type Area, type DemandItem, type PlanningCode, type Restriction, type WeekDay } from '../src/lib/planning';
import { demandReport, readDemandExcel, readTrainingExcel } from '../src/lib/planning-excel';

const codes:PlanningCode[]=[...['T','P','X','N'].map((code,sort)=>({kind:'COLCHON' as const,code,name:code,active:true,sort})),...['J','C','NP'].map((code,sort)=>({kind:'PANEL' as const,code,name:code,active:true,sort}))];
const restriction=(id:number,applies_to:'COLCHON'|'PANEL',c:string[],max:number,sizes:number[]|null=null):Restriction=>({id,name:`R${id}`,applies_to,codes:c,sizes,max_per_day:max,active:true,notes:null,sort:id});
const item=(material_code:string,mattress_type:string,panel_type:string,size_cm:number,monthly_demand:number):DemandItem=>({material_code,description:material_code,mattress_type,panel_type,size_cm,monthly_demand,active:true});
const head=['Material','Descripción del material','TIPO DE COLCHON','TIPO DE PANEL','MEDIDA','PROMEDIO VENTA MENSUAL VOLUMEN'];
const folder='BASES DE DATOS LAMITEX/MODULOS DEMANDA/';

test('carga de demanda: normaliza letras, ignora encabezado repetido y unifica filas idénticas',()=>{
 const r=parseDemandRows([head,head,['A1','Uno','x','NP',135,10],['A2','Dos','T','',160,5],['A2','Dos','T','NP',160,5],[null,null,null,null,null,null]],codes);
 assert.deepEqual(r.errors,[]);assert.equal(r.rows.length,2);assert.equal(r.rows[0].mattress_type,'X');assert.equal(r.rows[1].panel_type,'NP');assert.ok(r.warnings.some(w=>w.includes('repetida')));
});
test('carga de demanda: rechaza letras fuera del catálogo y repetidos con datos distintos',()=>{
 const r=parseDemandRows([head,['A1','Uno','Z','NP',135,10],['A2','Dos','T','J',160,5],['A2','Dos','T','J',160,9]],codes);
 assert.equal(r.errors.length,2);
});
test('carga de demanda: columnas en otro orden se rechazan',()=>{
 assert.throws(()=>parseDemandRows([['Material','MEDIDA','TIPO DE COLCHON','TIPO DE PANEL','x','y']],codes),/columnas/);
});
test('diferencias: detecta nuevos, cambios y sin cambio',()=>{
 const d=diffDemand([{material_code:'A',description:'A',mattress_type:'T',panel_type:'NP',size_cm:135,monthly_demand:10,source_row:2},{material_code:'B',description:'B',mattress_type:'T',panel_type:'C',size_cm:135,monthly_demand:5,source_row:3},{material_code:'C',description:'C',mattress_type:'T',panel_type:'NP',size_cm:135,monthly_demand:1,source_row:4}],[item('A','T','NP',135,10),item('B','T','J',135,5)]);
 assert.deepEqual(d.map(x=>x.status),['IGUAL','CAMBIA','NUEVO']);assert.match(d[1].changes[0],/J→C/);
});
test('restricciones: X y N comparten capacidad; T solo cuenta en medidas 160 y 200; panel por letra de panel',()=>{
 const caja=restriction(1,'COLCHON',['X','N'],150),t=restriction(2,'COLCHON',['T'],100,[160,200]),j=restriction(3,'PANEL',['J'],150);
 assert.ok(matchesRestriction(item('a','N','J',135,1),caja));assert.ok(matchesRestriction(item('a','X','NP',135,1),caja));
 assert.ok(!matchesRestriction(item('a','T','NP',135,1),t));assert.ok(matchesRestriction(item('a','T','NP',200,1),t));
 assert.ok(matchesRestriction(item('a','X','J',135,1),j));assert.ok(!matchesRestriction(item('a','X','C',135,1),j));
});
test('jornada 07:00-19:00 con 1 h de almuerzo = 11 h netas, 3 h extra sobre 8 ordinarias',()=>{
 const week:WeekDay[]=[1,2,3,4,5].map(weekday=>({weekday,is_working:true,start_time:'07:00',end_time:'19:00',break_minutes:60,ordinary_hours:8})).concat([6,7].map(weekday=>({weekday,is_working:false,start_time:'07:00',end_time:'17:00',break_minutes:60,ordinary_hours:0})));
 assert.equal(netHours(week[0]),11);
 const areas:Area[]=[{id:1,name:'TAPICERÍA',headcount:10,default_attendance_pct:90,limits_capacity:true,active:true,notes:null,sort:1},{id:2,name:'MARCOS',headcount:5,default_attendance_pct:70,limits_capacity:false,active:true,notes:null,sort:2}];
 const cal=buildCalendar('2026-10',week,[{day:'2026-10-10',weekday:6,is_working:true,start_time:'07:00',end_time:'17:00',break_minutes:60,ordinary_hours:0,note:'Sábado'}],areas,[],[{day:'2026-10-01',area_id:1,attendance_pct:80,note:null}]);
 assert.equal(cal.length,31);assert.equal(cal[0].overtime,3);assert.equal(cal[0].factor,.8);assert.equal(cal[1].factor,.9);
 assert.equal(cal.find(d=>d.day==='2026-10-10')!.hours,9);assert.equal(cal.filter(d=>d.is_working).length,23);
 const cap=capacitySummary([restriction(1,'COLCHON',['P'],40)],[item('a','P','NP',135,2000)],cal,11);
 assert.equal(cap[0].maxMonth,23*40);assert.ok(cap[0].effectiveMonth<cap[0].maxMonth);assert.ok(cap[0].gap>0);
});
test('programa vs restricciones: suma por grupo y marca excesos',()=>{
 const r=checkProgram([{material_code:'a',description:null,quantity:120},{material_code:'b',description:null,quantity:60},{material_code:'z',description:null,quantity:5}],[item('a','X','J',135,1),item('b','N','NP',135,1)],[restriction(1,'COLCHON',['X','N'],150),restriction(2,'PANEL',['J'],150)]);
 assert.equal(r.checks[0].planned,180);assert.equal(r.checks[0].excess,30);assert.equal(r.checks[1].excess,0);assert.equal(r.unknown.length,1);
});
test('Excel real DEMANDAS.LAMITEX se lee sin errores',{skip:!existsSync(folder+'DEMANDAS.LAMITEX.xlsx')},async()=>{
 const r=await readDemandExcel(await readFile(folder+'DEMANDAS.LAMITEX.xlsx'),codes);
 assert.deepEqual(r.errors,[]);assert.equal(r.rows.length,242);assert.ok(r.rows.every(x=>codes.some(c=>c.code===x.mattress_type)));
});
test('Excel real de programas de entrenamiento: 4 días reconocidos',{skip:!existsSync(folder+'PROGRAMAS ENTRENAMIENTO LAMITEX.xlsx')},async()=>{
 const r=await readTrainingExcel(await readFile(folder+'PROGRAMAS ENTRENAMIENTO LAMITEX.xlsx'));
 assert.deepEqual(r.programs.map(p=>p.weekday).sort(),['JUEVES','LUNES','MIERCOLES','VIERNES']);assert.ok(r.programs.every(p=>!p.errors.length&&p.lines.length>10));
});
test('reporte de demanda genera 3 hojas',async()=>{
 const snap={material_code:'A',description:'A',mattress_type:'T',panel_type:'NP',size_cm:135,monthly_demand:10,active:true};
 const buf=await demandReport('2026-10-01','2026-10-31',[snap],[{...snap,monthly_demand:12}],[{...snap,source:'MANUAL',changed_at:new Date().toISOString()}]);
 const book=new ExcelJS.Workbook();await book.xlsx.load(buf as any);assert.equal(book.worksheets.length,3);assert.equal(book.worksheets[1].getRow(2).getCell(5).value,2);
});
