import { describe, expect, it } from 'vitest';
import { canConnect, connect, createNode, pasteNodes, removeNodes } from '../../src/ui/studio/editing';
import { PNode, PortId, ProcessGraph, REJECT_KINDS, isLiquidHaul, isReuse, validateGraph } from '../../src/simulation/treatment/graph';
import { starterGraph } from '../../src/game/project';
import { CATALOGUE, UnitType } from '../../src/simulation/treatment/catalogue';

// The PFD's connection rule as it was in Studio.tsx before the extraction (2026-11-28), kept as the parity reference.
const OLD_SLUDGE_RECEIVERS: PNode['kind'][] = ['thickener', 'filterPress', 'dryer', 'disposal', 'mixer'];
function oldIsValid(g: ProcessGraph, source: string, handle: string | null, target: string): boolean {
  if (!source || !target || source === target) return false;
  const to = g.nodes.find((n) => n.id === target);
  if (!to || to.kind === 'influent') return false;
  if (handle === 'ras') return to.kind === 'activatedSludge';
  const sludge = handle === 'sludge';
  const from = g.nodes.find((n) => n.id === source);
  if (sludge && from && REJECT_KINDS.includes(from.kind)) return !isReuse(to);
  if (sludge) return OLD_SLUDGE_RECEIVERS.includes(to.kind) && !isReuse(to);
  return to.kind !== 'disposal' || isLiquidHaul(to) || isReuse(to);
}

function everyKindGraph(): ProcessGraph {
  const nodes: PNode[] = [...starterGraph([]).nodes];
  for (const k of Object.keys(CATALOGUE) as UnitType[]) nodes.push(createNode(k, 100, nodes));
  nodes.push(createNode('disposal', 100, nodes), createNode('liquidHaul', 100, nodes), createNode('reclaim', 100, nodes));
  return { nodes, edges: [] };
}

describe('shared editing rules (2D PFD and 3D site)', () => {
  it('canConnect matches the old PFD rule for every source × port × target', () => {
    const g = everyKindGraph();
    const ports: PortId[] = ['out', 'sludge', 'ras', 'a', 'b'];
    let n = 0;
    for (const from of g.nodes)
      for (const port of ports)
        for (const to of g.nodes) {
          expect(canConnect(g, from.id, port, to.id).ok, `${from.kind}.${port} → ${to.kind}`).toBe(oldIsValid(g, from.id, port, to.id));
          n++;
        }
    expect(n).toBeGreaterThan(3000);
  });

  it('refusals carry a reason', () => {
    const g = everyKindGraph();
    const cl = g.nodes.find((x) => x.kind === 'clarifier')!;
    const eq = g.nodes.find((x) => x.kind === 'eq')!;
    const r = canConnect(g, cl.id, 'sludge', eq.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sludge/i);
  });

  it('connect / remove / add / paste keep the graph consistent', () => {
    let g = starterGraph([]);
    const inf = g.nodes.find((n) => n.kind === 'influent')!;
    const dis = g.nodes.find((n) => n.kind === 'discharge')!;
    const eq = createNode('eq', 100, g.nodes);
    g = { ...g, nodes: [...g.nodes, eq] };
    g = connect(connect(g, inf.id, 'out', eq.id), eq.id, 'out', dis.id);
    expect(connect(g, inf.id, 'out', eq.id)).toBe(g); // no duplicate pipe
    expect(validateGraph(g).filter((e) => e.level === 'error')).toEqual([]);
    const pasted = pasteNodes(g, { nodes: [{ ...eq, site: { x: 10, z: 5, rot: 90 } }], edges: [] }, 100, () => true);
    expect(pasted.added).toHaveLength(1);
    const copy = pasted.graph.nodes.find((n) => n.id === pasted.added[0])!;
    expect(copy.site).toEqual({ x: 14, z: 9, rot: 90 });
    const removed = removeNodes(pasted.graph, [eq.id, inf.id]);
    expect(removed.nodes.some((n) => n.id === inf.id)).toBe(true); // terminals survive
    expect(removed.edges.some((e) => e.from === eq.id || e.to === eq.id)).toBe(false);
  });
});
