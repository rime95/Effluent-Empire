/**
 * Process graph solver: nodes are units (plus one influent and one discharge), edges are pipes.
 * Solved in topological order; a node with several inlets is a mixer (flow-weighted blend + re-equilibration);
 * a node with several outlets splits its outflow equally. Cycles are rejected in Phase 1
 * (activated sludge recycle is internal to the reactor model).
 */
import { BalanceCheck, Components, addComponents, checkMassBalance, components, zeroComponents } from '../core/massBalance';
import { POOLS, Stream, blend, cloneStream, poolMass } from '../core/stream';
import { equilibrate } from '../chemistry/acidBase';
import { CATALOGUE, PRICES, Params, UnitType } from './catalogue';
import { Note, ProcessResult } from './types';

export type NodeKind = UnitType | 'influent' | 'discharge';

export interface PNode {
  id: string;
  kind: NodeKind;
  /** display tag, e.g. CL-04 */
  tag?: string;
  params: Params;
  /** canvas position (UI only) */
  position?: { x: number; y: number };
  /** out of service: the stream passes through untreated (O&M breakdowns) */
  bypass?: boolean;
}

export interface PEdge {
  id: string;
  from: string;
  to: string;
}

export interface ProcessGraph {
  nodes: PNode[];
  edges: PEdge[];
}

export interface NodeSim {
  node: PNode;
  inlet: Stream;
  result: ProcessResult;
  capex: number;
  footprint: number;
  balance: BalanceCheck;
  sludgeKgD: number;
  opexRMd: number;
}

export interface SimResult {
  ok: boolean;
  errors: Note[];
  order: string[];
  nodes: Record<string, NodeSim>;
  edges: Record<string, Stream>;
  effluent: Stream | null;
  capex: number;
  footprint: number;
  opexRMd: number;
  /** OPEX split at base prices, RM/d (market indices are applied by the game layer) */
  opexSplit: { chemicals: number; energy: number; sludge: number };
  energy_kWhd: number;
  sludgeKgD: number;
  chemicals: { name: string; kgPerDay: number; costRMd: number }[];
  balance: BalanceCheck | null;
}

function sumPartial(...xs: Partial<Components>[]): Components {
  return addComponents(...xs.map((x) => ({ ...zeroComponents(), ...x })));
}

export function validateGraph(g: ProcessGraph): Note[] {
  const errs: Note[] = [];
  const inf = g.nodes.filter((n) => n.kind === 'influent');
  const dis = g.nodes.filter((n) => n.kind === 'discharge');
  if (inf.length !== 1) errs.push({ level: 'error', code: 'graph.influent', text: 'The design needs exactly one raw-wastewater inlet.' });
  if (dis.length !== 1) errs.push({ level: 'error', code: 'graph.discharge', text: 'The design needs exactly one final discharge point.' });
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) errs.push({ level: 'error', code: 'graph.dangling', text: 'A pipe is connected to a unit that no longer exists.' });
    if (g.nodes.find((n) => n.id === e.from)?.kind === 'discharge') errs.push({ level: 'error', code: 'graph.dischargeOutlet', text: 'The discharge point cannot have an outlet pipe.' });
    if (g.nodes.find((n) => n.id === e.to)?.kind === 'influent') errs.push({ level: 'error', code: 'graph.influentInlet', text: 'The raw-wastewater inlet cannot receive a pipe.' });
  }
  for (const n of g.nodes) {
    const ins = g.edges.filter((e) => e.to === n.id).length;
    const outs = g.edges.filter((e) => e.from === n.id).length;
    if (n.kind !== 'influent' && ins === 0) errs.push({ level: 'error', code: 'graph.noInlet', text: `${n.tag ?? n.kind} has no inlet pipe.` });
    if (n.kind !== 'discharge' && outs === 0) errs.push({ level: 'error', code: 'graph.noOutlet', text: `${n.tag ?? n.kind} has no outlet pipe.` });
  }
  return errs;
}

function topoSort(g: ProcessGraph): string[] | null {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of g.edges.filter((x) => x.from === id)) {
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  return order.length === g.nodes.length ? order : null;
}

export function simulate(g: ProcessGraph, influent: Stream): SimResult {
  const res: SimResult = {
    ok: false,
    errors: validateGraph(g),
    order: [],
    nodes: {},
    edges: {},
    effluent: null,
    capex: 0,
    footprint: 0,
    opexRMd: 0,
    opexSplit: { chemicals: 0, energy: 0, sludge: 0 },
    energy_kWhd: 0,
    sludgeKgD: 0,
    chemicals: [],
    balance: null,
  };
  if (!(influent.Q > 0)) res.errors.push({ level: 'error', code: 'graph.noFlow', text: 'Influent flow must be greater than zero.' });
  const order = res.errors.length ? null : topoSort(g);
  if (!order && !res.errors.length) res.errors.push({ level: 'error', code: 'graph.cycle', text: 'Recycle loops between units are not supported yet.' });
  if (res.errors.length || !order) return res;
  res.order = order;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const chem = new Map<string, { kg: number; price: number }>();
  let sysIn = zeroComponents();
  let sysOut = zeroComponents();
  const sysTerms = { sludge: zeroComponents(), gas: zeroComponents(), consumed: zeroComponents(), produced: zeroComponents() };

  for (const id of order) {
    const node = byId.get(id)!;
    const inEdges = g.edges.filter((e) => e.to === id);
    const outEdges = g.edges.filter((e) => e.from === id);
    let inlet: Stream;
    if (node.kind === 'influent') {
      inlet = cloneStream(influent);
      sysIn = components(inlet);
    } else {
      const ins = inEdges.map((e) => res.edges[e.id]).filter(Boolean);
      inlet = ins.length === 1 ? cloneStream(ins[0]) : equilibrate(blend(ins));
    }
    if (node.kind === 'discharge') {
      res.effluent = inlet;
      sysOut = components(inlet);
      continue;
    }
    let outlet = inlet;
    if (node.kind !== 'influent' && !node.bypass) {
      const def = CATALOGUE[node.kind];
      const clarifierFollows = outEdges.length > 0 && outEdges.every((e) => byId.get(e.to)?.kind === 'clarifier');
      const r = def.run(inlet, node.params, { clarifierFollows });
      const sludge = r.removed ? components(r.removed, false) : zeroComponents();
      const balance = checkMassBalance({
        in: components(inlet),
        out: components(r.out),
        sludge,
        gas: sumPartial(r.gas),
        consumed: sumPartial(r.consumed),
        produced: sumPartial(r.produced),
      });
      const capex = def.capex(node.params, inlet, r);
      const footprint = def.footprint(node.params);
      const dry = r.removed ? (r.removed.Q * (POOLS.reduce((acc, p) => acc + poolMass(r.removed!, p), 0) + r.removed.OGfree + r.removed.OGemulsified)) / 1000 : 0;
      const metalSludge = r.removed ? r.removed.precipitated.Ni + r.removed.precipitated.Cu + r.removed.precipitated.Zn > 0 : false;
      const chemCost = r.chemicals.reduce((a, c) => a + c.kgPerDay * c.priceRMkg, 0);
      const energyCost = r.energy_kWhd * PRICES.electricity_kWh;
      const sludgeCost = dry * (metalSludge ? PRICES.sludgeDisposal_kg.metal : PRICES.sludgeDisposal_kg.other);
      const opex = chemCost + energyCost + sludgeCost;
      res.opexSplit.chemicals += chemCost;
      res.opexSplit.energy += energyCost;
      res.opexSplit.sludge += sludgeCost;
      for (const c of r.chemicals) {
        const prev = chem.get(c.name) ?? { kg: 0, price: c.priceRMkg };
        chem.set(c.name, { kg: prev.kg + c.kgPerDay, price: c.priceRMkg });
      }
      res.nodes[id] = { node, inlet, result: r, capex, footprint, balance, sludgeKgD: dry, opexRMd: opex };
      res.capex += capex;
      res.footprint += footprint;
      res.energy_kWhd += r.energy_kWhd;
      res.sludgeKgD += dry;
      res.opexRMd += opex;
      sysTerms.sludge = addComponents(sysTerms.sludge, sludge);
      sysTerms.gas = addComponents(sysTerms.gas, sumPartial(r.gas));
      sysTerms.consumed = addComponents(sysTerms.consumed, sumPartial(r.consumed));
      sysTerms.produced = addComponents(sysTerms.produced, sumPartial(r.produced));
      outlet = r.out;
    }
    const share = outEdges.length > 0 ? 1 / outEdges.length : 1;
    for (const e of outEdges) {
      const s = cloneStream(outlet);
      s.Q = outlet.Q * share;
      res.edges[e.id] = s;
    }
  }
  res.chemicals = [...chem.entries()].map(([name, v]) => ({ name, kgPerDay: v.kg, costRMd: v.kg * v.price }));
  res.balance = checkMassBalance({ in: sysIn, out: sysOut, ...sysTerms });
  res.ok = !!res.effluent;
  return res;
}

/** Convenience: build a linear train influent → units… → discharge. */
export function linearGraph(units: { kind: UnitType; params: Params }[]): ProcessGraph {
  const nodes: PNode[] = [{ id: 'in', kind: 'influent', params: {} }];
  units.forEach((u, i) => nodes.push({ id: `u${i}`, kind: u.kind, tag: `${CATALOGUE[u.kind].tagPrefix}-${String(i + 1).padStart(2, '0')}`, params: u.params }));
  nodes.push({ id: 'out', kind: 'discharge', params: {} });
  const edges: PEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ id: `e${i}`, from: nodes[i].id, to: nodes[i + 1].id });
  return { nodes, edges };
}
