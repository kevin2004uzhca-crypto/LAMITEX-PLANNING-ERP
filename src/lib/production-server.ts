import 'server-only';
import { fetchAll } from '@/lib/planning-server';
import { endOfDay, startOfDay, TZ } from '@/lib/qr';
import type { supabaseServer } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof supabaseServer>>;

/** Día (yyyy-mm-dd) de un instante, en hora de Ecuador. */
const ecDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
/** yyyy-mm-dd sumando días (sin depender de la zona horaria del servidor). */
export const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export type DayTotal = { date: string; planned: number; packed: number; received: number };

/**
 * Programado, empacado y recibido en bodega por día (hora de Ecuador) en un rango.
 * Empacado y recibido se cuentan por la fecha en que se escanearon.
 */
export async function loadDailyTotals(db: Db, from: string, to: string): Promise<DayTotal[]> {
  const [plans, packed, received] = await Promise.all([
    fetchAll<{ plan_date: string; quantity: number }>((a, b) => db.from('lmx_qr_daily_plans').select('plan_date,quantity').gte('plan_date', from).lte('plan_date', to).order('id').range(a, b)),
    fetchAll<{ packed_at: string }>((a, b) => db.from('lmx_qr_labels').select('packed_at').gte('packed_at', startOfDay(from)).lte('packed_at', endOfDay(to)).order('id').range(a, b)),
    fetchAll<{ received_at: string }>((a, b) => db.from('lmx_qr_labels').select('received_at').gte('received_at', startOfDay(from)).lte('received_at', endOfDay(to)).order('id').range(a, b)),
  ]);
  const days = new Map<string, DayTotal>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, planned: 0, packed: 0, received: 0 });
  for (const p of plans) { const r = days.get(p.plan_date); if (r) r.planned += Number(p.quantity); }
  for (const l of packed) { const r = days.get(ecDay(l.packed_at)); if (r) r.packed++; }
  for (const l of received) { const r = days.get(ecDay(l.received_at)); if (r) r.received++; }
  return [...days.values()];
}

export type ProductionItem = { sap_code: string; name: string };
/**
 * Códigos SAP que se pueden programar: los colchones activos del catálogo de productos y,
 * además, los códigos de la demanda que aún no estén en el catálogo. El código SAP es la llave.
 */
export async function loadProductionCatalog(db: Db): Promise<ProductionItem[]> {
  const [skus, demand] = await Promise.all([
    fetchAll<any>((a, b) => db.from('product_skus').select('sap_material_code,commercial_measure,active,product_models!inner(canonical_name,catalog_name_original,active)').eq('active', true).order('id').range(a, b)),
    fetchAll<{ material_code: string; description: string }>((a, b) => db.from('demand_items').select('material_code,description').eq('active', true).order('material_code').range(a, b)),
  ]);
  const out = new Map<string, ProductionItem>();
  for (const s of skus) {
    const code = String(s.sap_material_code ?? '').trim().toUpperCase(); const m = s.product_models;
    if (!code || !m?.active || out.has(code)) continue;
    out.set(code, { sap_code: code, name: [m.canonical_name || m.catalog_name_original, s.commercial_measure].filter(Boolean).join(' · ') });
  }
  for (const d of demand) { const code = d.material_code.trim().toUpperCase(); if (!out.has(code)) out.set(code, { sap_code: code, name: d.description || code }); }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.sap_code.localeCompare(b.sap_code));
}
