import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { mattressName, QR_MODULES, startOfDay, todayEc, type QrModule, type QrRole } from '@/lib/qr';

/** Usuario de los módulos QR. No exige perfil activo del ERP: empacador, bodega y oficina solo ven su módulo. */
export const requireQrUser = cache(async () => {
  const db = await supabaseServer();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  const [role, access, profile] = await Promise.all([
    db.rpc('lmx_qr_role'),
    db.from('lmx_qr_user_access').select('display_name').eq('user_id', user.id).maybeSingle(),
    db.from('user_profiles').select('display_name,active').eq('user_id', user.id).maybeSingle(),
  ]);
  const qrRole = (role.error ? null : role.data) as QrRole | null;
  if (!qrRole) redirect(profile.data?.active ? '/' : '/login?error=profile');
  const name = access.data?.display_name || profile.data?.display_name || user.email || 'Usuario';
  return { db, user, role: qrRole, name, erp: !!profile.data?.active };
});

export async function requireQrModule(module: QrModule) {
  const ctx = await requireQrUser();
  if (!QR_MODULES[module].roles.includes(ctx.role)) redirect('/control');
  return ctx;
}


export type CatalogItem = { sku_id: number; sap_code: string; model_name: string; measure: string | null; sap_name: string | null };
export async function loadCatalog(db: Awaited<ReturnType<typeof supabaseServer>>) {
  const r = await db.rpc('lmx_qr_catalog');
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as CatalogItem[];
}

/** Escaneos de hoy de una etapa (todos los usuarios) para el contador y el historial de la estación. */
export async function loadTodayScans(db: Awaited<ReturnType<typeof supabaseServer>>, stage: 'PACK' | 'WAREHOUSE') {
  const r = await db.from('lmx_qr_scans')
    .select('id,scanned_at,scanned_code,result,label_sap_code,manual,scanned_by_name,lmx_qr_labels(model_name,measure)')
    .eq('stage', stage).gte('scanned_at', startOfDay(todayEc())).order('scanned_at', { ascending: false }).limit(1000);
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((s: any) => ({ id: s.id, scanned_at: s.scanned_at, scanned_code: s.scanned_code, result: s.result, label_sap_code: s.label_sap_code, manual: s.manual, scanned_by_name: s.scanned_by_name,
    model: s.lmx_qr_labels ? mattressName(s.lmx_qr_labels) : null }));
}
