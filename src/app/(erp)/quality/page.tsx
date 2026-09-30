import { requireUser } from '@/lib/auth';
import pilot from '@/data/pilot.json';
import { validateBom } from '@/lib/bom';
export default async function Quality() {
  const {db}=await requireUser();const report=validateBom(pilot.nodes);const {data,error}=await db.from('validation_issues').select('id,issue_type,severity,message,status').order('created_at',{ascending:false}).limit(100);
  return <><p className="eyebrow">VALIDACIÓN Y TRAZABILIDAD</p><h1>Calidad de datos</h1><section className="panel"><h2>Observaciones del caso piloto</h2>{pilot.notes.map(n=><p className="alert" key={n}>{n}</p>)}<p>{report.valid?'La estructura 1–10 supera las verificaciones de padres, ciclos, niveles y cantidades.':'La estructura contiene errores.'} La asociación al producto y las unidades aún requieren revisión.</p></section><section className="panel"><h2>Incidencias registradas en el ERP</h2>{error?<p className="alert error">No se pudieron consultar las incidencias.</p>:!data?.length?<p className="muted">No hay incidencias persistidas. Las observaciones anteriores pertenecen a la revisión del piloto.</p>:<div className="table-scroll"><table><thead><tr><th>Regla</th><th>Severidad</th><th>Mensaje</th><th>Estado</th></tr></thead><tbody>{data.map(i=><tr key={i.id}><td>{i.issue_type}</td><td>{i.severity}</td><td>{i.message}</td><td>{i.status}</td></tr>)}</tbody></table></div>}</section></>;
}
