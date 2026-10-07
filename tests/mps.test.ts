import test from 'node:test';
import assert from 'node:assert/strict';
import highsLoader from 'highs';
import { DEFAULT_COSTS, DEFAULT_POLICY, DEFAULT_REGIMES, DEFAULT_SHIFTS, solveMps, type MpsInput } from '../src/lib/mps';
import { learnFromPrograms } from '../src/lib/mps-data';
import { forecastSeries, rng } from '../src/lib/forecast';
import { calculateNetMrp } from '../src/lib/mrp-net';

const loadHighs=()=>highsLoader() as Promise<any>;

// Planta de juguete: una semana de 5 días de 8 h, un área con 10 personas, 1 h estándar por colchón → 80 colchones/día.
const days=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'].map((date,i)=>({date,weekday:i+1,ordinaryHours:8,working:true}));
const input=(demand:number,regime=0,extra:Partial<MpsInput>={}):MpsInput=>({month:'2026-11',days:[...days,{date:'2026-11-07',weekday:6,ordinaryHours:0,working:false}],
 areas:[{key:'A1',name:'TAPICERÍA',headcount:10,absenteeismPct:0,hourlyWage:2,efficiency:1,inModel:true}],
 products:[{code:'3C00001',description:'Prueba',mattressType:'T',panelType:'NP',size:135,monthlyDemand:demand,hours:{A1:1},hoursSource:'RUTA',unitCost:100,stock:0,lot:1,hasEngineeringBom:true,hasSapList:true}],
 groups:[],policy:DEFAULT_POLICY,regime:DEFAULT_REGIMES[regime],costs:DEFAULT_COSTS,referenceHours:8,demandFactor:1,specialOrders:[],useInitialStock:false,integer:false,...extra});

test('plan maestro: sin horas extra cuando la jornada alcanza',async()=>{
 const r=solveMps(await loadHighs(),input(300));
 assert.equal(r.classification,'OPTIMO');assert.equal(r.kpis.produced,300);assert.ok(r.kpis.overtimeHours<0.5);
});
test('plan maestro: usa justo las horas extra que faltan y las cobra con el recargo legal',async()=>{
 const r=solveMps(await loadHighs(),input(480));
 assert.equal(r.classification,'CON_LAS_JUSTAS');assert.equal(r.kpis.unmet,0);
 assert.ok(Math.abs(r.kpis.overtimeHours-80)<1,`horas extra ${r.kpis.overtimeHours}`);
 assert.ok(Math.abs(r.kpis.laborCost-80*2*1.5)<2,`costo ${r.kpis.laborCost}`);
});
test('plan maestro: respeta el tope de 12 h extra por semana y reporta lo no cumplido',async()=>{
 const r=solveMps(await loadHighs(),input(600));
 assert.equal(r.classification,'NO_ALCANZA');
 assert.ok(r.kpis.overtimeHours<=120+0.5);assert.ok(Math.abs(r.kpis.unmet-80)<1,`no cumplido ${r.kpis.unmet}`);
});
test('plan maestro: el sábado solo entra en las formas de trabajar que lo permiten',async()=>{
 const highs=await loadHighs();
 const max=solveMps(highs,input(600,2));assert.ok(max.kpis.saturdayHours>0||max.kpis.unmet<80);
 const off=solveMps(highs,input(600,2,{policy:{...DEFAULT_POLICY,saturdayEnabled:false}}));assert.ok(off.kpis.saturdayHours<0.5);
});
test('plan maestro: el máximo por grupo se respeta día a día y crece con las horas extra',async()=>{
 const r=solveMps(await loadHighs(),input(300,0,{groups:[{key:'G1',name:'Tradicional',maxPerDay:50,codes:['3C00001'],areaKey:'A1'}]}));
 // 50/día en jornada = 250; los 50 que faltan salen con horas extra, que también amplían el máximo del grupo (50/8 por hora).
 assert.equal(r.kpis.produced,300);assert.ok(Math.abs(r.kpis.overtimeHours-80)<1);
 assert.ok(r.groups[0].daily.every(d=>d.planned<=d.capacity+d.forced+1),JSON.stringify(r.groups[0].daily));
});

// Dos turnos de 8 h con 10 personas cada uno; la noche rinde 85 % → 80 + 68 = 148 colchones por día.
const twoShifts=DEFAULT_SHIFTS.map(s=>({...s,referenceHours:8}));
test('turnos: la noche suma capacidad al 85 % y sin horas extra cuando alcanza',async()=>{
 const r=solveMps(await loadHighs(),input(740,0,{shifts:twoShifts}));
 assert.equal(r.classification,'OPTIMO');assert.equal(r.kpis.produced,740);assert.ok(r.kpis.overtimeHours<0.5);
 assert.equal(r.areas[0].shifts.length,2);assert.ok(Math.abs(r.areas[0].present-20)<1e-9);
});
test('turnos: la hora extra va primero al turno de día (la noche cuesta más y rinde menos)',async()=>{
 const r=solveMps(await loadHighs(),input(800,0,{shifts:twoShifts}));
 assert.equal(r.kpis.unmet,0);
 assert.ok(Math.abs(r.areas[0].shifts[0].overtimeHours-60)<1,JSON.stringify(r.areas[0].shifts));assert.ok(r.areas[0].shifts[1].overtimeHours<0.5);
 assert.ok(Math.abs(r.kpis.laborCost-60*2*1.5)<2,`costo ${r.kpis.laborCost}`);
});
test('turnos: el máximo por grupo vale para el día completo de los dos turnos',async()=>{
 const r=solveMps(await loadHighs(),input(500,0,{shifts:twoShifts,groups:[{key:'G1',name:'Tradicional',maxPerDay:100,codes:['3C00001'],areaKey:'A1'}]}));
 assert.equal(r.kpis.produced,500);assert.ok(r.kpis.overtimeHours<0.5);
 assert.ok(r.groups[0].daily.every(d=>d.planned<=d.capacity+1&&Math.abs(d.capacity-100)<1e-6),JSON.stringify(r.groups[0].daily));
});
test('aprendizaje: con dos turnos el rendimiento se mide sobre las horas de ambos',()=>{
 const areas=[{key:'A1',name:'TAPICERÍA',headcount:10,absenteeismPct:0,hourlyWage:2,efficiency:1,inModel:true}];
 const products=input(0).products;const programs=[{name:'Lunes',lines:[{material_code:'3C00001',quantity:148}]}];
 assert.ok(Math.abs(learnFromPrograms(programs,products,areas,[],8).efficiency.A1.mean-1.85)<1e-9);
 assert.ok(Math.abs(learnFromPrograms(programs,products,areas,[],8,twoShifts).efficiency.A1.mean-1)<1e-9);
});

test('pronóstico: sin historia usa la demanda vigente ± variación',()=>{
 const f=forecastSeries([],100,10);assert.equal(f.method,'DEMANDA_VIGENTE');assert.equal(Math.round(f.low),90);assert.equal(Math.round(f.high),110);
});
test('pronóstico: con tendencia elige un método que la sigue',()=>{
 const h=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'].map((period,i)=>({period,quantity:100+10*i}));
 const f=forecastSeries(h,150,10);assert.notEqual(f.method,'DEMANDA_VIGENTE');assert.ok(f.point>140,`pronóstico ${f.point}`);assert.ok(f.low<=f.point&&f.point<=f.high);
});
test('pronóstico: generador aleatorio reproducible',()=>{const a=rng(7),b=rng(7);assert.equal(a(),b());});

test('MRP neto: explota árbol y lista SAP, descuenta inventario y adelanta la compra por lead time',()=>{
 const trees=new Map([['3C00001',{bomId:1,code:'3C00001',nodes:[
  {id:1,key:'r',parentKey:null,name:'Colchón',quantity:1,unit:'UN',leadTime:null,type:'ROOT',active:true},
  {id:2,key:'p',parentKey:'r',name:'Panel',quantity:2,unit:'UN',leadTime:null,type:'ASSEMBLY',active:true},
  {id:3,key:'e',parentKey:'p',name:'Espuma',quantity:1.5,unit:'M2',leadTime:7,type:'MATERIAL',active:true}]}]]);
 const lists=new Map([['3C00001',{headerId:1,code:'3C00001',base:1,unit:'UN',items:[{code:'ESP01',description:'Espuma',quantity:3,unit:'M2'},{code:'PEG01',description:'Pegamento',quantity:0.2,unit:'KG'}]}]]);
 const materials=new Map([['ESP01',{description:'Espuma',family:null,leadDays:14,safetyStock:0,purchaseUnit:'ROLLO',unitsPerPurchase:30,conversionConfirmed:true,conversionFromUnit:'M2'}]]);
 const r=calculateNetMrp([{code:'3C00001',description:'Prueba',weekly:[10,10]}],['2026-11-02','2026-11-09'],trees,lists,materials,new Map([['ESP01',{free:40,transit:0}]]),new Map([[3,'ESP01']]));
 assert.equal(r.bomComponents.find(c=>c.name==='Espuma')?.total,60);
 const esp=r.sapMaterials.find(m=>m.code==='ESP01')!;assert.equal(esp.origin,'BOM');assert.equal(esp.gross,60);assert.equal(esp.net,20);assert.equal(esp.releaseWeek,-1);assert.equal(esp.purchaseQuantity,1);
 assert.equal(r.sapMaterials.find(m=>m.code==='PEG01')?.origin,'COMPLEMENTARIO');
});
