/**
 * Process graph solver: nodes are units (plus one influent, one discharge and any number of sludge disposal points),
 * edges are pipes leaving a port ('out' main, 'sludge', or splitter 'a'/'b').
 * - several inlets → flow-weighted blend + re-equilibration (mixer);
 * - several main outlets → equal split; a splitter splits a/b by its 'split' %;
 * - sludge ports carry the removed solids as a real stream (knowledge/physical/sludge_thickening_dewatering.md);
 * - recycle loops are solved by successive substitution on tear streams (knowledge/design/recycle_streams.md).
 */
import { BalanceCheck, Components, addComponents, checkMassBalance, components, zeroComponents } from '../core/massBalance';
import { METALS, POOLS, Stream, blend, cloneStream, codTotal, emptyStream, metalTotal, poolMass, tss } from '../core/stream';
import { effectiveParams, instCapex, type InstKey } from './instrumentation';
import { BACKWASH_FRACTION, defaultSludgeFraction, removedDryKgD, splitSludge } from '../physical/sludge';
import { equilibrate } from '../chemistry/acidBase';
import { CATALOGUE, PRICES, Params, UnitType } from './catalogue';
import { Note, ProcessResult } from './types';

export type NodeKind = UnitType | 'influent' | 'discharge' | 'disposal';
/** A disposal point in liquid mode: licensed tanker haulage of concentrated liquid waste (accepts any line). */
export const isLiquidHaul = (n: { kind: string; params?: Record<string, unknown> }) => n.kind === 'disposal' && n.params?.liquid === 'yes';
export type PortId = 'out' | 'sludge' | 'a' | 'b' | 'ras';
/** unit kinds with a sludge draw-off port */
export const SLUDGE_PORT_KINDS: NodeKind[] = ['clarifier', 'oilSep', 'sandFilter', 'thickener', 'filterPress'];

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
  /** drawn mirrored (inlet on the right, outlet on the left) — UI only */
  flip?: boolean;
  /** instrumentation / redundancy switched on or off (missing = standard set installed) — see instrumentation.ts */
  inst?: Partial<Record<InstKey, boolean>>;
}

export interface PEdge {
  id: string;
  from: string;
  to: string;
  /** outlet port of the source node (default 'out') */
  fromPort?: PortId;
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
  /** recycle (tear) edges and the iterations needed to converge */
  tears: string[];
  iterations: number;
  /** sludge disposal points: wet and dry mass, cost */
  disposal: { id: string; wetKgD: number; dryKgD: number; costRMd: number; metal: boolean; liquid?: boolean; m3d?: number }[];
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
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const e of g.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) {
      errs.push({ level: 'error', code: 'graph.dangling', text: 'A pipe is connected to a unit that no longer exists.' });
      continue;
    }
    if (e.fromPort === 'ras' && (from.kind !== 'clarifier' || to.kind !== 'activatedSludge')) errs.push({ level: 'error', code: 'graph.ras', text: 'A RAS line runs from a secondary clarifier back to its aeration basin.' });
    if (from.kind === 'discharge' || from.kind === 'disposal') errs.push({ level: 'error', code: 'graph.dischargeOutlet', text: `${from.tag ?? from.kind} is an end point and cannot have an outlet pipe.` });
    if (to.kind === 'influent') errs.push({ level: 'error', code: 'graph.influentInlet', text: 'The raw-wastewater inlet cannot receive a pipe.' });
    if (e.fromPort === 'sludge' && !SLUDGE_PORT_KINDS.includes(from.kind)) errs.push({ level: 'error', code: 'graph.noSludgePort', text: `${from.tag ?? from.kind} has no sludge outlet.` });
    const sludgeLine = isSludgeEdge(g, e);
    if (to.kind === 'disposal' && !sludgeLine && !isLiquidHaul(to)) errs.push({ level: 'error', code: 'graph.disposalWater', text: `Only sludge lines can go to ${to.tag ?? 'sludge disposal'} — treated water must go to the final discharge.` });
    if (sludgeLine && to.kind === 'discharge') errs.push({ level: 'error', code: 'graph.sludgeToRiver', text: `Sludge from ${from.tag ?? from.kind} reaches the final discharge — send it to a thickener, filter press or sludge disposal.` });
    if (sludgeLine && e.fromPort !== 'ras' && !['thickener', 'filterPress', 'disposal', 'mixer', 'splitter'].includes(to.kind)) errs.push({ level: 'warn', code: 'graph.sludgeIntoProcess', text: `Sludge is piped into ${to.tag ?? to.kind} — treatment units are not designed for 1 % solids feed.` });
  }
  // advice: a secondary clarifier after activated sludge should show its RAS line (the model assumes the return either way)
  for (const c of g.nodes.filter((x) => x.kind === 'clarifier')) {
    const fedByAS = g.edges.some((e) => e.to === c.id && g.nodes.find((n) => n.id === e.from)?.kind === 'activatedSludge');
    if (fedByAS && !g.edges.some((e) => e.from === c.id && e.fromPort === 'ras')) errs.push({ level: 'info', code: 'graph.noRAS', text: `${c.tag ?? 'Clarifier'}: draw the RAS line (round brown RAS nozzle → aeration basin). The model assumes the return; draw it so the PFD, P&ID and stream table show it.` });
  }
  // holding mode decants nothing only if its sludge actually goes on; without a sludge pipe everything leaves via the outlet
  for (const n of g.nodes.filter((x) => x.kind === 'thickener' && x.params.mode === 'holding')) {
    if (!g.edges.some((e) => e.from === n.id && e.fromPort === 'sludge')) errs.push({ level: 'warn', code: 'graph.holdingNoSludge', text: `${n.tag ?? 'Thickener'} is a holding tank but its sludge outlet is not piped — connect it to the filter press, or everything overflows to the outlet.` });
  }
  for (const n of g.nodes.filter((x) => x.kind === 'splitter')) {
    const outs = g.edges.filter((e) => e.from === n.id);
    if (outs.length && (outs.every((e) => e.fromPort !== 'b') || outs.every((e) => e.fromPort === 'b'))) errs.push({ level: 'warn', code: 'graph.splitterOneSide', text: `${n.tag ?? 'Splitter'} has only one outlet connected — its split % is ignored and all flow goes that way.` });
  }
  for (const n of g.nodes) {
    const ins = g.edges.filter((e) => e.to === n.id).length;
    const mainOuts = g.edges.filter((e) => e.from === n.id && e.fromPort !== 'sludge' && e.fromPort !== 'ras').length;
    if (n.kind !== 'influent' && ins === 0) errs.push({ level: 'error', code: 'graph.noInlet', text: `${n.tag ?? n.kind} has no inlet pipe.` });
    if (n.kind !== 'discharge' && n.kind !== 'disposal' && mainOuts === 0) errs.push({ level: 'error', code: 'graph.noOutlet', text: `${n.tag ?? n.kind} has no outlet pipe.` });
  }
  return errs;
}

/** A pipe carries sludge if it leaves a sludge port, or leaves a mixer/splitter fed by sludge. */
export function isSludgeEdge(g: ProcessGraph, e: PEdge, seen = new Set<string>()): boolean {
  if (e.fromPort === 'sludge' || e.fromPort === 'ras') return true;
  const from = g.nodes.find((n) => n.id === e.from);
  if (!from || (from.kind !== 'mixer' && from.kind !== 'splitter') || seen.has(from.id)) return false;
  seen.add(from.id);
  return g.edges.filter((x) => x.to === from.id).some((x) => isSludgeEdge(g, x, seen));
}

/** Back-edges of a depth-first search from the inlet: the tear streams that break recycle loops. */
export function findTears(g: ProcessGraph): string[] {
  const state = new Map<string, 0 | 1 | 2>(); // 0 new, 1 on stack, 2 done
  const tears: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of g.edges.filter((x) => x.from === id)) {
      const st = state.get(e.to) ?? 0;
      if (st === 1) tears.push(e.id);
      else if (st === 0) visit(e.to);
    }
    state.set(id, 2);
  };
  const roots = [...g.nodes.filter((n) => n.kind === 'influent'), ...g.nodes.filter((n) => n.kind !== 'influent')];
  for (const n of roots) if ((state.get(n.id) ?? 0) === 0) visit(n.id);
  return tears;
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

function emptyResult(errors: Note[]): SimResult {
  return { ok: false, errors, order: [], nodes: {}, edges: {}, effluent: null, capex: 0, footprint: 0, opexRMd: 0, opexSplit: { chemicals: 0, energy: 0, sludge: 0 }, energy_kWhd: 0, sludgeKgD: 0, chemicals: [], balance: null, tears: [], iterations: 0, disposal: [] };
}

const isMetalSludge = (s: Stream) => s.precipitated.Ni + s.precipitated.Cu + s.precipitated.Zn + s.precipitated.Cr > 0;
/** liquid waste is classed as metal-bearing (scheduled waste) above this total heavy-metal content, mg/L (GAME MODEL, verify) */
const METAL_LIQUOR_MGL = 5;

/** One pass over the (tear-broken) flowsheet in topological order. */
function solvePass(g: ProcessGraph, order: string[], influent: Stream, tears: Set<string>, tearIn: Map<string, Stream>): SimResult {
  const res = emptyResult([]);
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
      res.capex += instCapex(node); // inlet flow meter
    } else {
      // RAS lines are internal to the activated-sludge model (MLSS retention), shown but not re-added as flow
      const ins = inEdges.filter((e) => e.fromPort !== 'ras').map((e) => (tears.has(e.id) ? tearIn.get(e.id) : res.edges[e.id])).filter((x): x is Stream => !!x && x.Q > 1e-9);
      inlet = ins.length === 0 ? emptyStream(0) : ins.length === 1 ? cloneStream(ins[0]) : equilibrate(blend(ins));
    }
    if (node.kind === 'discharge') {
      res.effluent = inlet;
      sysOut = addComponents(sysOut, components(inlet));
      continue;
    }
    if (node.kind === 'disposal' && isLiquidHaul(node)) {
      // liquid scheduled-waste haulage: small volumes of concentrated liquor, priced per m³ hauled (not discharged)
      const m3d = inlet.Q;
      const metalMgL = METALS.reduce((a, m) => a + metalTotal(inlet, m), 0) + (inlet.CrVI ?? 0);
      const metal = metalMgL > METAL_LIQUOR_MGL;
      const costRMd = m3d * (metal ? PRICES.liquidHaul_m3.metal : PRICES.liquidHaul_m3.other);
      const dryKgD = (inlet.Q * (POOLS.reduce((a, p) => a + poolMass(inlet, p), 0) + inlet.OGfree + inlet.OGemulsified)) / 1000;
      res.disposal.push({ id, wetKgD: m3d * 1000, dryKgD, costRMd, metal, liquid: true, m3d });
      res.opexSplit.sludge += costRMd;
      res.opexRMd += costRMd;
      if (m3d > PRICES.tanker_m3) res.errors.push({ level: 'warn', code: 'haul.volume', text: `${node.tag ?? 'Liquid haulage'}: ${m3d.toFixed(1)} m³/d is ${Math.ceil(m3d / PRICES.tanker_m3)} tanker loads a day — haulage suits small concentrated streams; concentrate it first (evaporator, RO brine reduction) or treat it.` });
      sysOut = addComponents(sysOut, components(inlet));
      continue;
    }
    if (node.kind === 'disposal') {
      const dryKgD = (inlet.Q * (POOLS.reduce((a, p) => a + poolMass(inlet, p), 0) + inlet.OGfree + inlet.OGemulsified)) / 1000;
      const wetKgD = inlet.Q * 1000; // ρ ≈ 1000 kg/m³ (cake ≈ 1200: conservative for tankered sludge)
      const metal = isMetalSludge(inlet);
      const costRMd = wetKgD * (metal ? PRICES.disposalWet_kg.metal : PRICES.disposalWet_kg.other);
      res.disposal.push({ id, wetKgD, dryKgD, costRMd, metal });
      res.opexSplit.sludge += costRMd;
      res.opexRMd += costRMd;
      sysOut = addComponents(sysOut, components(inlet));
      continue;
    }
    let outlet = inlet;
    let sludgeOut: Stream | null = null;
    const sludgeEdges = outEdges.filter((e) => e.fromPort === 'sludge');
    const rasEdges = outEdges.filter((e) => e.fromPort === 'ras');
    const mainEdges = outEdges.filter((e) => e.fromPort !== 'sludge' && e.fromPort !== 'ras');
    let rasOut: Stream | null = null;
    if (node.kind !== 'influent' && !node.bypass && inlet.Q > 1e-9) {
      const def = CATALOGUE[node.kind];
      const clarifierFollows = mainEdges.length > 0 && mainEdges.every((e) => byId.get(e.to)?.kind === 'clarifier');
      const r = def.run(inlet, effectiveParams(node), { clarifierFollows });
      const sludge = r.removed ? components(r.removed, false) : zeroComponents();
      const balance = checkMassBalance({
        in: components(inlet),
        out: components(r.out),
        sludge,
        gas: sumPartial(r.gas),
        consumed: sumPartial(r.consumed),
        produced: sumPartial(r.produced),
      });
      const capex = def.capex(node.params, inlet, r) + instCapex(node);
      const footprint = def.footprint(node.params);
      const dry = r.removed ? removedDryKgD(r.removed) : 0;
      const routed = sludgeEdges.length > 0 && !!r.removed && dry > 0;
      const metalSludge = r.removed ? isMetalSludge(r.removed) : false;
      const chemCost = r.chemicals.reduce((a, c) => a + c.kgPerDay * c.priceRMkg, 0);
      const energyCost = r.energy_kWhd * PRICES.electricity_kWh;
      // routed sludge is costed where it leaves the system (disposal point); unrouted → contractor at the dry price
      const sludgeCost = routed ? 0 : dry * (metalSludge ? PRICES.sludgeDisposal_kg.metal : PRICES.sludgeDisposal_kg.other);
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
      res.sludgeKgD += routed ? 0 : dry;
      res.opexRMd += opex;
      sysTerms.gas = addComponents(sysTerms.gas, sumPartial(r.gas));
      sysTerms.consumed = addComponents(sysTerms.consumed, sumPartial(r.consumed));
      sysTerms.produced = addComponents(sysTerms.produced, sumPartial(r.produced));
      outlet = r.out;
      // RAS stream for display: return ratio × flow at the underflow concentration Xr (same solids as the WAS)
      if (rasEdges.length && inlet.ml?.ras && r.removed) {
        const xr = inlet.ml.xr ?? 8000;
        const dryAll = removedDryKgD(r.removed);
        const wasLike = splitSludge(r.out, r.removed, inlet.Q, dryAll / (Math.max(xr, 1) / 1000)).sludge;
        rasOut = cloneStream(wasLike);
        rasOut.Q = inlet.ml.ras * inlet.Q;
      }
      if (routed) {
        const frac = r.sludgeSolidsFrac ?? defaultSludgeFraction(node.kind, inlet, r.removed);
        const Qs = frac === null ? BACKWASH_FRACTION * inlet.Q : dry / (Math.max(frac, 1e-4) * 1000);
        const split = r.sludgeAll ? splitSludge(r.out, r.removed!, inlet.Q, inlet.Q, 1) : splitSludge(r.out, r.removed!, inlet.Q, Qs);
        outlet = split.main;
        sludgeOut = split.sludge;
        res.nodes[id].result = { ...r, out: split.main };
      } else {
        sysTerms.sludge = addComponents(sysTerms.sludge, sludge);
      }
    } else if (node.kind !== 'influent' && !node.bypass) {
      // no flow reaches this unit (e.g. first pass of a recycle loop): register it with zero duty
      const def = CATALOGUE[node.kind];
      // equipment is still built: CAPEX from its parameters, evaluated on the plant influent as a sizing proxy
      const proxy = def.run(cloneStream(influent), node.params, { clarifierFollows: false });
      const capex = def.capex(node.params, influent, proxy) + instCapex(node);
      res.capex += capex;
      res.footprint += def.footprint(node.params);
      res.nodes[id] = { node, inlet, result: { ...proxy, out: emptyStream(0), removed: null, chemicals: [], energy_kWhd: 0, calcs: {}, notes: [{ level: 'warn', code: 'unit.dry', text: 'No flow reaches this unit — it is built but idle.' }] }, capex, footprint: def.footprint(node.params), balance: checkMassBalance({ in: zeroComponents(), out: zeroComponents(), sludge: zeroComponents(), gas: zeroComponents(), consumed: zeroComponents(), produced: zeroComponents() }), sludgeKgD: 0, opexRMd: 0 };
      outlet = emptyStream(0);
    }
    // main outlets: splitter a/b by %, otherwise equal split
    const isSplitter = node.kind === 'splitter' && !node.bypass;
    const aFrac = isSplitter ? Math.min(1, Math.max(0, Number(node.params.split ?? 50) / 100)) : 0;
    const aEdges = mainEdges.filter((e) => e.fromPort === 'a');
    const bEdges = mainEdges.filter((e) => e.fromPort !== 'a');
    for (const e of mainEdges) {
      let share = 1 / mainEdges.length;
      if (isSplitter && aEdges.length && bEdges.length) share = e.fromPort === 'a' ? aFrac / aEdges.length : (1 - aFrac) / bEdges.length;
      const st = cloneStream(outlet);
      st.Q = outlet.Q * share;
      res.edges[e.id] = st;
    }
    for (const e of rasEdges) {
      const st = rasOut ? cloneStream(rasOut) : emptyStream(0);
      st.Q = rasOut ? rasOut.Q / rasEdges.length : 0;
      res.edges[e.id] = st;
    }
    for (const e of sludgeEdges) {
      const st = sludgeOut ? cloneStream(sludgeOut) : emptyStream(0);
      st.Q = sludgeOut ? sludgeOut.Q / sludgeEdges.length : 0;
      res.edges[e.id] = st;
    }
  }
  res.chemicals = [...chem.entries()].map(([name, v]) => ({ name, kgPerDay: v.kg, costRMd: v.kg * v.price }));
  res.balance = checkMassBalance({ in: sysIn, out: sysOut, ...sysTerms });
  res.ok = !!res.effluent && res.effluent.Q > 0;
  return res;
}

/** Loads (mass flows) that must settle before a recycle is converged: water, solids, COD, metals, NH₄, sulfate. */
function tearLoads(s: Stream | undefined): number[] {
  if (!s) return [0, 0, 0, 0, 0, 0, 0, 0];
  const m = (k: 'Ni' | 'Cu' | 'Zn' | 'Cr') => s.Q * (s.dissolved[k] + s.precipitated[k]);
  return [s.Q, s.Q * tss(s), s.Q * codTotal(s), m('Ni'), m('Cu'), m('Zn'), s.Q * s.NH4N, s.Q * (s.SO4T ?? 0) * 1e5];
}
function tearDelta(a: Stream | undefined, b: Stream | undefined): number {
  const x = tearLoads(a);
  const y = tearLoads(b);
  const scale = Math.max(...y.map(Math.abs), 1e-9);
  return Math.max(...x.map((v, i) => Math.abs(v - y[i]) / Math.max(Math.abs(y[i]), 1e-3 * scale, 1e-6)));
}

/**
 * Stream ↔ mass-flow vector, for Wegstein acceleration: Q and Q·c for every concentration field (dissolved and
 * particulate maps included). Intensive fields (pH, T, peak factor, pKa) and settling data come from the template.
 */
const INTENSIVE = new Set(['Q', 'pH', 'T', 'peakFactor', 'weakAcidPKa']);
function toVec(s: Stream): number[] {
  const v = [s.Q];
  for (const [k, val] of Object.entries(s)) if (typeof val === 'number' && !INTENSIVE.has(k)) v.push(s.Q * val);
  for (const m of ['Ni', 'Cu', 'Zn', 'Cr'] as const) v.push(s.Q * s.dissolved[m], s.Q * s.precipitated[m]);
  return v;
}
function fromVec(template: Stream, v: number[]): Stream {
  const out = cloneStream(template);
  const Q = Math.max(v[0], 0);
  out.Q = Q;
  let i = 1;
  const c = (x: number) => (Q > 1e-12 ? Math.max(0, x) / Q : 0);
  for (const [k, val] of Object.entries(template)) if (typeof val === 'number' && !INTENSIVE.has(k)) (out as unknown as Record<string, number>)[k] = k === 'Cb' ? (Q > 1e-12 ? v[i] / Q : 0) : c(v[i]), i++;
  for (const m of ['Ni', 'Cu', 'Zn', 'Cr'] as const) {
    out.dissolved[m] = c(v[i++]);
    out.precipitated[m] = c(v[i++]);
  }
  return out;
}

export function simulate(gIn: ProcessGraph, influent: Stream): SimResult {
  // a unit with no pipes at all (just dropped on the sheet) is left out with a warning instead of blocking the whole design
  const loose = gIn.nodes.filter((n) => n.kind !== 'influent' && n.kind !== 'discharge' && !gIn.edges.some((e) => e.from === n.id || e.to === n.id));
  const g: ProcessGraph = loose.length ? { nodes: gIn.nodes.filter((n) => !loose.includes(n)), edges: gIn.edges } : gIn;
  const errors = validateGraph(g);
  for (const n of loose) errors.push({ level: 'warn', code: 'graph.loose', text: `${n.tag ?? n.kind} is not connected — it is left out of the calculation (and the build) until you pipe it in.` });
  if (!(influent.Q > 0)) errors.push({ level: 'error', code: 'graph.noFlow', text: 'Influent flow must be greater than zero.' });
  if (errors.some((e) => e.level === 'error')) return emptyResult(errors);
  const flowG: ProcessGraph = { nodes: g.nodes, edges: g.edges.filter((e) => e.fromPort !== 'ras') };
  const tears = findTears(flowG);
  const tearSet = new Set(tears);
  const order = topoSort({ nodes: g.nodes, edges: flowG.edges.filter((e) => !tearSet.has(e.id)) });
  if (!order) return emptyResult([{ level: 'error', code: 'graph.cycle', text: 'The flowsheet could not be ordered.' }]);
  let x = new Map<string, Stream>(); // tear values fed in
  let res = solvePass(g, order, influent, tearSet, x);
  let it = 1;
  if (tears.length) {
    // Successive substitution with bounded Wegstein acceleration per tear stream (q ∈ [−5, 0]; q = 0 is plain
    // substitution). Whenever the residual grows the solver drops acceleration for three passes and halves an
    // under-relaxation factor ω (x ← x + ω(f − x)), which damps the oscillating loops that nonlinear units such as
    // activated sludge or an overloaded thickener produce.
    let converged = false;
    let prevX: Map<string, number[]> | null = null;
    let prevF: Map<string, number[]> | null = null;
    let prevDelta = Infinity;
    let cooldown = 0; // passes without acceleration after the residual grew (Wegstein safeguard)
    // Biology inside a loop can have two steady states (healthy, or a solids-recirculation collapse). Extrapolation can
    // jump between them, so with activated sludge in the flowsheet the solver follows the start-up path: damped plain
    // substitution, no Wegstein (physically: the plant fills from empty with no recycle).
    const biology = g.nodes.some((n) => n.kind === 'activatedSludge');
    let omega = biology ? 0.7 : 1; // under-relaxation: halved each time the residual grows (damps oscillating loops)
    for (; it < 250; it++) {
      const f = new Map(tears.map((id) => [id, res.edges[id]] as const).filter((p): p is [string, Stream] => !!p[1]));
      const delta = Math.max(0, ...tears.map((id) => tearDelta(f.get(id), x.get(id))));
      if (it > 1 && delta < 1e-6) {
        converged = true;
        break;
      }
      // a loop still far from converged after 80 passes is running away (e.g. solids recirculating through an
      // overloaded thickener) — stop early instead of burning time
      if (it >= 80 && delta > 1e-2) break;
      if (delta > prevDelta) {
        cooldown = 3;
        omega = Math.max(0.1, omega * 0.5);
      }
      const accel = cooldown === 0 && !biology;
      if (cooldown > 0) cooldown--;
      prevDelta = delta;
      const nextX = new Map<string, Stream>();
      const curX = new Map<string, number[]>();
      const curF = new Map<string, number[]>();
      for (const id of tears) {
        const fs_ = f.get(id);
        if (!fs_) continue;
        const fv = toVec(fs_);
        const xv = x.get(id) ? toVec(x.get(id)!) : fv.map(() => 0);
        curX.set(id, xv);
        curF.set(id, fv);
        const px = prevX?.get(id);
        const pf = prevF?.get(id);
        const nv = fv.map((fi, k) => {
          if (!px || !pf || it < 3 || !accel) return xv[k] + omega * (fi - xv[k]);
          const dx = xv[k] - px[k];
          if (Math.abs(dx) < 1e-12) return fi;
          const slope = (fi - pf[k]) / dx;
          const q = Math.min(0, Math.max(-5, slope / (slope - 1)));
          return q * xv[k] + (1 - q) * fi;
        });
        nextX.set(id, fromVec(fs_, nv));
      }
      prevX = curX;
      prevF = curF;
      x = nextX;
      res = solvePass(g, order, influent, tearSet, x);
    }
    if (!converged) {
      res.errors.push({ level: 'error', code: 'graph.recycle', text: 'The recycle loop runs away — what is returned keeps growing (typically solids recirculating through an overloaded thickener or press). Enlarge the sludge-line equipment, return less flow, or remove the solids before recycling.' });
      res.ok = false;
    }
  }
  res.tears = tears;
  res.iterations = it;
  res.errors = [...errors, ...res.errors];
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
