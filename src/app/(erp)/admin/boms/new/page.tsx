import { requireEngineerPage,loadEngineering } from '@/lib/engineering-server';
import { emptyEngineeringBom,duplicateEngineering } from '@/lib/engineering';
import { EngineeringEditor } from '@/components/engineering-editor';
export default async function Page({searchParams}:{searchParams:Promise<{duplicate?:string}>}){await requireEngineerPage();const {duplicate}=await searchParams;const b=duplicate?await loadEngineering(Number(duplicate)):null;return <EngineeringEditor initial={b?duplicateEngineering(b):emptyEngineeringBom()}/>;}
