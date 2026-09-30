export type BomNode = {
  id: number; bom: string; name: string; parent: number | null; declaredLevel: number | null;
  quantity: number | null; unit: string | null; leadTime: number | null;
  sourceFile: string; sourceSheet: string; sourceRow: number; sequence: number;
  leadTimeUnit?: string | null; notes?: string | null; externalId?: string | null;
};
export type Issue = { code: string; severity: 'ERROR' | 'WARNING'; node: number | null; message: string };
export function sourceSheetFromNotes(notes: string | null) {
  try { const value = JSON.parse(notes ?? '{}').source_sheet; return typeof value === 'string' ? value : 'No informada'; }
  catch { return 'No informada'; }
}
export function validateBom(nodes: BomNode[]) {
  const issues: Issue[] = []; const byId = new Map<number, BomNode>();
  const levels: Record<number, number> = {}; const paths: Record<number, number[]> = {};
  const issue = (code: string, node: number | null, message: string, severity: Issue['severity'] = 'ERROR') => issues.push({ code, node, message, severity });
  const bom = nodes[0]?.bom;
  for (const n of nodes) {
    if (n.bom !== bom) issue('CROSS_BOM_PARENT', n.id, 'La selección contiene nodos de distintos BOM.');
    if (byId.has(n.id)) issue('DUPLICATE_NODE', n.id, 'ID repetido dentro del BOM.');
    byId.set(n.id, n);
    if (n.quantity === null || !Number.isFinite(n.quantity) || n.quantity <= 0) issue('INVALID_QUANTITY', n.id, 'La cantidad debe ser mayor que cero.');
    if (n.leadTime === null) issue('MISSING_LEAD_TIME', n.id, 'Lead time no informado.', 'WARNING');
    else if (!Number.isFinite(n.leadTime) || n.leadTime < 0) issue('INVALID_LEAD_TIME', n.id, 'Lead time inválido.');
    if (!n.unit) issue('MISSING_UOM', n.id, 'La fuente estructural no informa unidad.', 'WARNING');
    if (n.parent === n.id) issue('SELF_PARENT', n.id, 'Un nodo no puede ser su propio padre.');
    if (n.parent !== null && !nodes.some(p => p.id === n.parent && p.bom === n.bom)) issue('MISSING_PARENT', n.id, 'No existe el padre dentro de este BOM.');
  }
  if (!nodes.some(n => n.parent === null)) issue('NO_ROOT', null, 'No hay raíces de nivel 1.');
  // Iterative ancestor walk: no fixed depth limit or recursive stack overflow.
  for (const n of nodes) {
    const seen = new Set<number>(); const trail: number[] = []; let current: BomNode | undefined = n;
    let rooted = false;
    while (current) {
      if (seen.has(current.id)) { issue('CYCLE', n.id, 'La ruta contiene un ciclo.'); break; }
      seen.add(current.id); trail.push(current.id);
      if (current.parent === null) { rooted = true; break; }
      const parent: BomNode | undefined = byId.get(current.parent);
      if (!parent || parent.bom !== current.bom) break;
      current = parent;
    }
    if (rooted) {
      levels[n.id] = trail.length; paths[n.id] = trail.reverse();
      if (n.declaredLevel !== null && n.declaredLevel !== levels[n.id]) issue('LEVEL_MISMATCH', n.id, `Nivel declarado ${n.declaredLevel}; calculado ${levels[n.id]}.`, 'WARNING');
    } else issue('DISCONNECTED_NODE', n.id, 'No se alcanza una raíz válida.');
  }
  return { valid: !issues.some(i => i.severity === 'ERROR'), issues, levels, paths };
}
export function unitUsage(quantity: number, base: number) {
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(quantity)) throw new Error('Cantidad base inválida.');
  return quantity / base;
}
export function cumulativeUsage(factors: number[]) {
  if (factors.some(n => !Number.isFinite(n))) throw new Error('Factor inválido.');
  return factors.reduce((a, b) => a * b, 1);
}
