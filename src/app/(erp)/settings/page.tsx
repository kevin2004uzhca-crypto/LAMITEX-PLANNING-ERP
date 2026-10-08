import { requireUser } from '@/lib/auth';
export default async function Settings() {
  const {db,profile}=await requireUser();
  const database=await db.from('product_models').select('id',{count:'exact',head:true});
  const counts=await Promise.all([['product_models','Modelos'],['product_skus','SKU'],['engineering_boms','BOM de ingeniería'],['materials','Materiales']].map(async([t,l])=>({l,...await db.from(t).select('id',{count:'exact',head:true})})));
  const buckets=await Promise.all(['product-images','imports','reports','documents'].map(async b=>({name:b,...await db.storage.from(b).list('',{limit:1})})));
  return <><p className="eyebrow">CONEXIÓN Y ACCESO</p><h1>Estado del sistema</h1><section className="panel"><div className="health-list"><article><h3>Aplicación</h3><span className="badge">Activa</span></article><article><h3>Supabase Auth</h3><span className="badge">Sesión verificada</span><p>Perfil activo · {profile.role}</p></article><article><h3>Base de datos</h3><span className={`badge ${database.error?'error':''}`}>{database.error?'No disponible':'Consulta autorizada'}</span><p>Consulta con la sesión actual y reglas de acceso del ERP.</p></article><article><h3>Datos registrados</h3>{counts.map(c=><p key={c.l}>{c.l}: <strong>{c.error?'—':c.count}</strong></p>)}</article><article><h3>Archivos</h3>{buckets.map(b=><p key={b.name}>{b.name}: <strong>{b.error?'No disponible o sin permiso':'Acceso disponible'}</strong></p>)}</article></div></section></>;
}
