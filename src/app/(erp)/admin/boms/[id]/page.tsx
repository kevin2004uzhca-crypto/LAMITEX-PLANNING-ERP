import { notFound } from 'next/navigation';
import { requireEngineerPage,loadEngineering } from '@/lib/engineering-server';
import { EngineeringEditor } from '@/components/engineering-editor';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{saved?:string}>}){await requireEngineerPage();const {id}=await params;const bom=await loadEngineering(Number(id));if(!bom)notFound();const {saved}=await searchParams;return <>{saved&&<p role="status" className="alert">BOM guardado correctamente.</p>}<EngineeringEditor key={`${bom.id}-${bom.revision}`} initial={bom}/></>;}
