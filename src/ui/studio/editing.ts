/**
 * Design-editing rules shared by the 2D PFD canvas and the 3D site view (pure functions on a ProcessGraph).
 * Both views edit the same graph through these, so a pipe the PFD refuses is refused in 3D for the same reason.
 */
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import { PNode, PortId, ProcessGraph, REJECT_KINDS, isLiquidHaul, isReuse } from '../../simulation/treatment/graph';
import { makeNode } from '../../game/project';

/** kinds that may receive a sludge line */
export const SLUDGE_RECEIVERS: PNode['kind'][] = ['thickener', 'filterPress', 'dryer', 'disposal', 'mixer'];
/** fixed end points (one inlet, one discharge) — cannot be deleted */
export const isTerminal = (n: PNode) => n.kind === 'influent' || n.kind === 'discharge';
export const isNonUnit = (n: PNode) => isTerminal(n) || n.kind === 'disposal';
export const newEdgeId = () => `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** palette entries: process units plus the disposal-point variants */
export type AddKind = UnitType | 'disposal' | 'liquidHaul' | 'reclaim';

/**
 * Can a pipe run from `fromId`'s `port` to `toId`? Same rules as the PFD always had:
 * RAS only to an aeration tank; a reject (brine, concentrate, eluate) anywhere but the reclaim system; sludge only to
 * sludge-handling units; treated water never into a sludge disposal point.
 */
export function canConnect(g: ProcessGraph, fromId: string, port: PortId, toId: string): { ok: boolean; reason?: string } {
  if (!fromId || !toId || fromId === toId) return { ok: false, reason: 'A unit cannot feed itself.' };
  const to = g.nodes.find((n) => n.id === toId);
  const from = g.nodes.find((n) => n.id === fromId);
  if (!to || !from) return { ok: false, reason: 'Unknown unit.' };
  if (to.kind === 'influent') return { ok: false, reason: 'Raw wastewater is a source — nothing flows into it.' };
  if (port === 'ras') return to.kind === 'activatedSludge' ? { ok: true } : { ok: false, reason: 'Return activated sludge goes back to the aeration tank.' };
  if (port === 'sludge') {
    if (REJECT_KINDS.includes(from.kind)) return !isReuse(to) ? { ok: true } : { ok: false, reason: 'Brine / concentrate cannot go to the reclaim system.' };
    if (isReuse(to)) return { ok: false, reason: 'Sludge cannot go to the reclaim system.' };
    return SLUDGE_RECEIVERS.includes(to.kind) ? { ok: true } : { ok: false, reason: 'A sludge line goes to a thickener, filter press, dryer, mixing box or sludge disposal.' };
  }
  if (to.kind === 'disposal' && !isLiquidHaul(to) && !isReuse(to)) return { ok: false, reason: 'Treated water goes to the final discharge, not to sludge disposal.' };
  return { ok: true };
}

/** add a pipe (no duplicates, no self-loops); `fromPort` stored only when not the main outlet */
export function connect(g: ProcessGraph, fromId: string, port: PortId, toId: string): ProcessGraph {
  if (fromId === toId || g.edges.some((e) => e.from === fromId && e.to === toId && (e.fromPort ?? 'out') === port)) return g;
  return { ...g, edges: [...g.edges, { id: newEdgeId(), from: fromId, to: toId, ...(port !== 'out' ? { fromPort: port } : {}) }] };
}

/** delete units (never the raw-water inlet or the final discharge) and their pipes */
export function removeNodes(g: ProcessGraph, ids: string[]): ProcessGraph {
  return { nodes: g.nodes.filter((n) => !ids.includes(n.id) || isTerminal(n)), edges: g.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)) };
}

const isSludgeKind = (k: string) => k === 'disposal' || k === 'liquidHaul' || CATALOGUE[k as UnitType]?.category === 'sludge';

/** A new unit node for the palette kind (disposal variants get their params and tags). No position. */
export function createNode(kind: AddKind, Q: number, nodes: PNode[]): PNode {
  const node = kind === 'liquidHaul' || kind === 'reclaim' ? makeNode('disposal', Q, nodes) : makeNode(kind, Q, nodes);
  if (kind === 'reclaim') {
    node.params = { reuse: 'yes' };
    node.tag = `RW-${String(nodes.filter((x) => isReuse(x)).length + 1).padStart(2, '0')}`;
  }
  if (kind === 'liquidHaul') {
    node.params = { liquid: 'yes' };
    node.tag = `LH-${String(nodes.filter((x) => isLiquidHaul(x)).length + 1).padStart(2, '0')}`;
  }
  return node;
}

/** PFD position for a new unit: process units along the main line, sludge units on a second row (nozzles never overlap) */
export function nextPfdPosition(nodes: PNode[], kind: AddKind): { x: number; y: number } {
  const units = nodes.filter((n) => !isNonUnit(n) && !isSludgeKind(n.kind)).length;
  const sludgeUnits = nodes.filter((n) => isSludgeKind(n.kind)).length;
  return isSludgeKind(kind) ? { x: 360 + sludgeUnits * 190, y: 420 } : { x: 180 + units * 190, y: 160 };
}

/**
 * Paste a clipboard (units + pipes between them) as fresh units offset by +40 px on the PFD (and +4 m on the site).
 * Returns the new graph, the ids added, and the clipboard shifted for the next paste.
 */
export function pasteNodes(g: ProcessGraph, clip: ProcessGraph, Q: number, allowed: (kind: PNode['kind']) => boolean): { graph: ProcessGraph; added: string[]; nextClip: ProcessGraph } {
  const map = new Map<string, string>();
  const nodes = [...g.nodes];
  for (const n of clip.nodes) {
    if (!allowed(n.kind)) continue;
    const fresh = makeNode(n.kind, Q, nodes);
    const pos = n.position ?? { x: 200, y: 200 };
    const added: PNode = { ...fresh, params: { ...n.params }, position: { x: pos.x + 40, y: pos.y + 40 }, ...(n.site ? { site: { ...n.site, x: n.site.x + 4, z: n.site.z + 4 } } : {}) };
    map.set(n.id, added.id);
    nodes.push(added);
  }
  const edges = [...g.edges, ...clip.edges.filter((e) => map.has(e.from) && map.has(e.to)).map((e) => ({ id: newEdgeId(), from: map.get(e.from)!, to: map.get(e.to)!, ...(e.fromPort ? { fromPort: e.fromPort } : {}) }))];
  const nextClip: ProcessGraph = {
    nodes: clip.nodes.map((n) => ({ ...n, position: n.position ? { x: n.position.x + 40, y: n.position.y + 40 } : n.position, ...(n.site ? { site: { ...n.site, x: n.site.x + 4, z: n.site.z + 4 } } : {}) })),
    edges: clip.edges,
  };
  return { graph: { nodes, edges }, added: [...map.values()], nextClip };
}
