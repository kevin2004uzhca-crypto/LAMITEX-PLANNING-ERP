import { requireUser } from '@/lib/auth';
import { SapImport } from '@/components/sap-import';
export default async function Page(){const {profile}=await requireUser();return <><p className="eyebrow">BOM DE MATERIALES</p><h1>Actualizar listas SAP</h1>{['ADMIN','ENGINEERING'].includes(profile.role)?<SapImport/>:<p>Tu rol no permite importar listas SAP.</p>}</>;}
