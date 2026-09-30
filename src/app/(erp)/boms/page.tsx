import { EngineeringDirectory } from '@/components/engineering-directory';
export default async function Page({searchParams}:{searchParams:Promise<{q?:string;page?:string;state?:string}>}){return <EngineeringDirectory {...await searchParams}/>;}
