import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
export default async function Page(){const {db}=await requireUser();const sku=await db.from('product_skus').select('id').eq('sap_material_code','3C83010').limit(1).maybeSingle();if(sku.data){const b=await db.from('engineering_boms').select('id').eq('product_sku_id',sku.data.id).order('version',{ascending:false}).limit(1).maybeSingle();if(b.data)redirect(`/boms/${b.data.id}`);}redirect('/boms');}
