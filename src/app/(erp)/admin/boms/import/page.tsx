import { requireEngineerPage } from '@/lib/engineering-server';
import { EngineeringImport } from '@/components/engineering-import';
export default async function Page(){await requireEngineerPage();return <EngineeringImport/>;}
