import { matchesRestriction, type DemandItem, type PlanningCode, type Restriction } from '@/lib/planning';

/**
 * Grupos de programación de un código SAP: tipo de colchón, tipo de panel y los grupos de
 * Restricciones (caja, piloto, paneles jumbo, confort…). Es la misma forma en que se programa en planta.
 */
export type GroupDef = { key: string; label: string; kind: 'COLCHON' | 'PANEL' | 'RESTRICCION' };
export function groupCatalog(codes: PlanningCode[], restrictions: Restriction[]): GroupDef[] {
  return [
    ...codes.filter(c => c.active && c.kind === 'COLCHON').map(c => ({ key: `C:${c.code}`, label: `Colchón ${c.name}`, kind: 'COLCHON' as const })),
    ...codes.filter(c => c.active && c.kind === 'PANEL').map(c => ({ key: `P:${c.code}`, label: `Panel ${c.name}`, kind: 'PANEL' as const })),
    ...restrictions.filter(r => r.active).map(r => ({ key: `R:${r.id}`, label: r.name, kind: 'RESTRICCION' as const })),
  ];
}
export function groupsOf(item: Pick<DemandItem, 'mattress_type' | 'panel_type' | 'size_cm'> | undefined, restrictions: Restriction[]) {
  if (!item) return [] as string[];
  return [`C:${item.mattress_type}`, `P:${item.panel_type}`, ...restrictions.filter(r => r.active && matchesRestriction(item, r)).map(r => `R:${r.id}`)];
}
