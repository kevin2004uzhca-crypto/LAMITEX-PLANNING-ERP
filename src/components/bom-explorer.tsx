'use client';
import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, useReactFlow, type Node, type Edge, Handle, Position, type NodeProps } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Search, Maximize, ChevronDown, ChevronRight } from 'lucide-react';
import { validateBom, type BomNode } from '@/lib/bom';
import '@xyflow/react/dist/style.css';
type CardData = { label: string; detail: string; kind: string; collapsed: boolean; hasChildren: boolean; secondary: boolean; toggle: () => void };
function BomCard({ data, selected }: NodeProps<Node<CardData>>) {
  return <div className={`bom-card ${data.kind} ${selected ? 'selected' : ''}`}><Handle type="target" position={Position.Top}/><div className="node-heading"><strong>{data.label}</strong>{data.hasChildren && <button className="nodrag node-toggle" aria-label={`${data.collapsed ? 'Expandir' : 'Contraer'} ${data.label}`} onClick={data.toggle}>{data.collapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}</button>}</div>{data.secondary && <small>{data.detail}</small>}<Handle type="source" position={Position.Bottom}/></div>;
}
const nodeTypes = { bom: BomCard };
function Canvas({ items, title }: { items: BomNode[]; title: string }) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState(''); const [secondary, setSecondary] = useState(true);
  const [nodes, setNodes] = useState<Node<CardData>[]>([]); const [edges, setEdges] = useState<Edge[]>([]);
  const [layoutError, setLayoutError] = useState(false);
  const flow = useReactFlow();
  const validation = useMemo(() => validateBom(items), [items]);
  const path = selected === null ? [] : validation.paths[selected] ?? [];
  const detail = items.find(n => n.id === selected);
  useEffect(() => {
    let disposed = false;
    const visible = items.filter(n => !(validation.paths[n.id] ?? []).slice(0, -1).some(id => collapsed.has(id)));
    const base: Node<CardData>[] = [{ id: 'root', type: 'bom', position: { x: 0, y: 0 }, data: { label: title, detail: 'PRODUCTO TERMINADO · NIVEL 0', kind: 'root', hasChildren: false, collapsed: false, secondary, toggle: () => {} } }, ...visible.map(n => ({ id: String(n.id), type: 'bom', position: { x: 0, y: 0 }, data: { label: n.name, detail: `Cant. ${n.quantity ?? '—'} ${n.unit ?? '(unidad pendiente)'} · LT ${n.leadTime ?? '—'} · N${validation.levels[n.id] ?? '?'}`, kind: items.some(c => c.parent === n.id) ? 'assembly' : 'component', hasChildren: items.some(c => c.parent === n.id), collapsed: collapsed.has(n.id), secondary, toggle: () => setCollapsed(old => { const next = new Set(old); if (next.has(n.id)) next.delete(n.id); else next.add(n.id); return next; }) } }))];
    const links: Edge[] = visible.filter(n => n.parent === null || visible.some(p => p.id === n.parent)).map(n => ({ id: `edge-${n.id}`, source: n.parent === null ? 'root' : String(n.parent), target: String(n.id), type: 'smoothstep', style: { stroke: '#82a69c', strokeWidth: 1.6 } }));
    const elk = new ELK();
    elk.layout({ id: 'bom', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '75', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' }, children: base.map(n => ({ id: n.id, width: 244, height: 94 })), edges: links.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })) }).then(result => {
      if (disposed) return;
      setNodes(base.map(n => { const p = result.children?.find(c => c.id === n.id); return { ...n, position: { x: p?.x ?? 0, y: p?.y ?? 0 } }; })); setEdges(links);
      requestAnimationFrame(() => flow.fitView({ padding: .16, duration: 200 }));
    }).catch(() => { if (!disposed) setLayoutError(true); });
    return () => { disposed = true; };
  }, [items, title, collapsed, secondary, validation, flow]);
  const selectedNodes = nodes.map(n => ({ ...n, selected: n.id === String(selected), className: query && n.data.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? 'search-match' : '' }));
  const selectedEdges = edges.map(e => ({ ...e, style: { ...e.style, stroke: path.includes(Number(e.target)) ? '#2c6975' : '#82a69c', strokeWidth: path.includes(Number(e.target)) ? 3 : 1.6 } }));
  function search(value: string) { setQuery(value); if (value) { const match = items.find(n => n.name.toLocaleLowerCase().includes(value.toLocaleLowerCase())); if (match) { setSelected(match.id); setCollapsed(new Set()); } } }
  return <section className="bom-panel"><div className="tree-toolbar"><label className="search"><Search size={17}/><input aria-label="Buscar componente" placeholder="Buscar componente…" value={query} onChange={e => search(e.target.value)}/></label><button onClick={() => setCollapsed(new Set())}>Expandir todo</button><button onClick={() => setCollapsed(new Set(items.filter(n => n.parent === null).map(n => n.id)))}>Contraer</button><button onClick={() => flow.fitView({ padding: .16, duration: 200 })}><Maximize size={15}/> Ajustar</button><label className="inline-check"><input type="checkbox" checked={secondary} onChange={e => setSecondary(e.target.checked)}/> Detalles</label></div><div className="tree-body"><div className="tree-canvas">{layoutError ? <p role="alert">No se pudo distribuir el árbol. Recarga la vista.</p> : <ReactFlow nodes={selectedNodes} edges={selectedEdges} nodeTypes={nodeTypes} onNodeClick={(_, n) => setSelected(n.id === 'root' ? null : Number(n.id))} nodesDraggable={false} nodesConnectable={false} minZoom={.15} maxZoom={2} fitView><Background color="#cbdad5" gap={22}/><Controls showInteractive={false}/><MiniMap nodeColor={n => n.id === 'root' ? '#2c6975' : '#68b2a0'} pannable zoomable/></ReactFlow>}</div><aside className="node-detail"><p className="eyebrow">DETALLE DE COMPONENTE</p>{detail ? <><h3>{detail.name}</h3><p className="breadcrumb">{title} → {path.map(id => items.find(n => n.id === id)?.name).join(' → ')}</p><dl>{detail.externalId&&<><dt>Código histórico</dt><dd>{detail.externalId}</dd></>}<dt>Padre</dt><dd>{items.find(n => n.id === detail.parent)?.name ?? 'Producto terminado'}</dd><dt>Nivel declarado / calculado</dt><dd>{detail.declaredLevel} / {validation.levels[detail.id] ?? 'No válido'}</dd><dt>Cantidad</dt><dd>{detail.quantity}</dd><dt>Unidad</dt><dd>{detail.unit ?? 'No informada en fuente'}</dd><dt>Lead time</dt><dd>{detail.leadTime ?? 'No informado'} · {detail.leadTimeUnit ?? 'Unidad temporal no informada'}</dd>{detail.notes&&<><dt>Observaciones</dt><dd>{detail.notes}</dd></>}<dt>Hijos directos</dt><dd>{items.filter(n => n.parent === detail.id).length}</dd><dt>Fuente</dt><dd>{detail.sourceFile}<br/>{detail.sourceSheet} · fila {detail.sourceRow}</dd></dl>{validation.issues.filter(i => i.node === detail.id).map((i, index) => <p className="alert" key={index}>{i.code}: {i.message}</p>)}</> : <><h3>Del producto al componente</h3><p className="muted">Selecciona un nodo para comprobar su padre, cantidad y fila de origen.</p><dl><dt>Nodos</dt><dd>{items.length}</dd><dt>Profundidad</dt><dd>{Math.max(0, ...Object.values(validation.levels))} niveles</dd><dt>Estructura</dt><dd>{validation.valid ? 'Sin errores estructurales' : 'Requiere corrección'}</dd></dl></>}</aside></div></section>;
}
export function BomExplorer(props: { items: BomNode[]; title: string }) { return <ReactFlowProvider><Canvas {...props}/></ReactFlowProvider>; }
