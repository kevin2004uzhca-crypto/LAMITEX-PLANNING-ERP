import { mkdirSync,writeFileSync } from 'node:fs';
import { writeEngineeringWorkbook } from '../src/lib/engineering-excel';
import { emptyEngineeringBom,type EngineeringBom } from '../src/lib/engineering';
async function main(){
 const boms:EngineeringBom[]=[3,4,5].map(depth=>({...emptyEngineeringBom(),design:`QA · Importación Excel ${depth} niveles 2026-09-26`,description:'Prueba de carga masiva. Archivada al finalizar.',lifecycle:'ARCHIVED',nodes:Array.from({length:depth},(_,i)=>({key:`N${i+1}`,parentKey:i?`N${i}`:null,externalId:null,name:`Componente QA ${i+1}`,declaredLevel:i+1,quantity:i+1,unit:null,leadTime:0.3,leadTimeUnit:null,notes:null,active:true,sequence:i+1,sourceFile:null,sourceRow:null}))}));
 mkdirSync('reports/engineering-qa',{recursive:true});
 writeFileSync('reports/engineering-qa/bulk-3-4-5.xlsx',await writeEngineeringWorkbook(boms));
 console.log('Prepared application-generated browser import fixture: 3 BOM, 12 nodes, 3/4/5 levels, archived.');
}
main();
