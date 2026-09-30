import { requireUser } from '@/lib/auth';
import { mrpContext,loadMrpItems,loadMrpMaterials } from '@/lib/materials-server';
import { calculateGrossMrp,type MrpInput } from '@/lib/mrp';
import { checkOrigin,apiError } from '@/lib/engineering-api';
export async function POST(req:Request){try{
 checkOrigin(req);const {db,profile,user}=await requireUser();if(!['ADMIN','ENGINEERING','PLANNER','SUPERVISOR'].includes(profile.role))return Response.json({error:'Tu rol permite consultar ejecuciones guardadas.'},{status:403});
 const {plan}=await req.json() as {plan:MrpInput[]};if(!Array.isArray(plan)||!plan.length||plan.length>100)throw new Error('Programa entre 1 y 100 productos.');
 const [{products,headers},materials,units]=await Promise.all([mrpContext(),loadMrpMaterials(),db.from('material_units').select('code').eq('confirmed',true).eq('active',true)]);if(units.error)throw new Error(units.error.message);
 const selected=await loadMrpItems(headers.filter(h=>plan.some(p=>p.headerId===h.id)));
 const result=calculateGrossMrp(plan,products,selected,materials,units.data.map(u=>u.code));
 const saved=await db.from('mrp_runs').insert({created_by:user.id,status:result.status,input:plan,result}).select('id').single();if(saved.error)throw new Error(saved.error.message);
 return Response.json({id:saved.data.id,result});
 }catch(e){return apiError(e);}}
