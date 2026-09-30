'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import pilot from '@/data/pilot.json';
import { validateBom } from '@/lib/bom';
export async function importPilot(form:FormData){
  const {db,profile}=await requireUser();
  if(!['ADMIN','ENGINEERING'].includes(profile.role))redirect('/imports?error=role');
  if(form.get('confirm')!=='yes'||!validateBom(pilot.nodes).valid)redirect('/imports?error=confirm');
  const {data,error}=await db.rpc('import_pilot_101',{payload:{...pilot,associationConfirmed:true}});
  if(error)redirect('/imports?error=persist');
  revalidatePath('/');revalidatePath('/products');revalidatePath('/materials');
  redirect(`/products/${data}`);
}
