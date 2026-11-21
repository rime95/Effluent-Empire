/**
 * Upgrades of an operating plant as a variation order (VO). Ref: knowledge/operations/om_model.md ("Upgrades").
 * The player edits a copy of the as-built graph in the Engineering Studio; the works are priced like a retrofit
 * (changed units × RETROFIT_PREMIUM; instrument-only changes for the instruments only; set-points are free) and built
 * while the plant runs. GAME MODEL (verify: VO markup, rework premium).
 *
 * Who pays — per unit, like an instructed VO scope (wwtp-process-engineer review 2026-11-22):
 *  1. Compliance: the plant fails its standard at today's load (steady model on the as-built hardware with the draft's
 *     set-points, so detuning a set-point does not count) AND it failed ≥ 2 of its last 4 weekly samples. The client
 *     pays for the changed units without which the draft would fail again.
 *  2. Reliability: an instrument or standby that remedies an unused incident logged on that unit in the last 12 weeks.
 *     The client pays for those instruments only.
 *  Everything else in the draft is operator-funded.
 */
import { Stream, cloneStream } from '../simulation/core/stream';
import { evaluate } from '../simulation/treatment/compliance';
import { PNode, ProcessGraph, SimResult, simulate } from '../simulation/treatment/graph';
import { SETPOINTS } from './incidents';
import { applicableInstruments, hasInst, instCapex } from '../simulation/treatment/instrumentation';
import { INCIDENT_REMEDY, OMContract, Plant, indexedFee, omFeeQuote, recommendedMaintenance } from './operations';
import { RETROFIT_PREMIUM, changedUnits, pipingChanged, removedUnits, unitRetrofitCharge } from './project';

/** client's VO price over the operator's cost (contractor overhead & profit on variation works) — verify */
export const VO_MARKUP = 1.25;
/** incidents within this many weeks make a remedial instrument client-funded */
export const RELIABILITY_LOOKBACK_WEEKS = 12;
/** compliance VO: failed weekly samples needed among the last four */
export const COMPLIANCE_FAILS = 2;

export interface PlantUpgrade {
  graph: ProcessGraph;
  phase: 'draft' | 'building';
  /** set when submitted */
  cost?: number;
  price?: number;
  clientFunded?: boolean;
  reason?: string;
  doneWeek?: number;
}

export interface UpgradeQuote {
  ok: boolean;
  errors: string[];
  /** total works cost, paid by the operator when ordered */
  cost: number;
  weeks: number;
  changed: string[];
  removed: string[];
  /** part of the cost in the client's VO scope, and the VO price (scope × markup) paid at hand-over */
  clientCost: number;
  clientUnits: string[];
  clientFunded: boolean;
  price: number;
  reason: string;
  currentPass: boolean;
  draftPass: boolean;
  /** unit ids whose logged incidents this VO uses up */
  usedIncidents: string[];
}

/** The plant's influent at today's production level (design stream × growth factor of the last operated week). */
export function currentInfluent(p: Plant): Stream {
  const s = cloneStream(p.trueStream);
  s.Q *= p.history[p.history.length - 1]?.flowFactor ?? 1;
  return s;
}

/** Does the plant meet its standard on a given simulation? */
export function passes(p: Plant, sim: SimResult): boolean {
  return !!(sim.ok && sim.effluent && evaluate(sim.effluent, p.standard, sim).pass);
}

/** Graph `g` with every operator set-point taken from the same unit in `from` (where it exists). */
export function withSetpointsFrom(g: ProcessGraph, from: ProcessGraph): ProcessGraph {
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      const src = from.nodes.find((x) => x.id === n.id && x.kind === n.kind);
      const keys = (SETPOINTS[n.kind] ?? []).map((d) => d.key);
      if (!src || !keys.length) return n;
      const params = { ...n.params };
      for (const k of keys) if (src.params[k] !== undefined) params[k] = src.params[k];
      return { ...n, params };
    }),
  };
}

/** Bypass a unit: its single inlet pipe is joined to its single process outlet. null if it cannot be bypassed simply. */
function bypassUnit(g: ProcessGraph, id: string): ProcessGraph | null {
  const ins = g.edges.filter((e) => e.to === id);
  const outs = g.edges.filter((e) => e.from === id && e.fromPort !== 'sludge' && e.fromPort !== 'ras');
  if (ins.length !== 1 || outs.length !== 1) return null;
  const join = { ...ins[0], id: `${ins[0].id}-bp`, to: outs[0].to };
  return { nodes: g.nodes.filter((n) => n.id !== id), edges: [...g.edges.filter((e) => e.from !== id && e.to !== id), join] };
}

/** Instrument keys switched on in `n` that were off (or absent) in `prev`. */
function addedInstruments(prev: PNode | undefined, n: PNode): string[] {
  return applicableInstruments(n.kind, n.params)
    .filter((d) => hasInst(n, d.key) && !(prev && hasInst(prev, d.key)))
    .map((d) => d.key);
}

/**
 * Price, duration and funding of an upgrade draft. `sims.next` lets the Studio pass the draft simulation it already
 * has on today's influent (only when it is up to date with `draft`).
 */
export function upgradeQuote(p: Plant, draft: ProcessGraph, week: number, sims?: { next?: SimResult }): UpgradeQuote {
  const inf = currentInfluent(p);
  const next = sims?.next ?? simulate(draft, inf);
  // the as-built hardware with the draft's set-points: a detuned set-point is not a design deficiency
  const now = simulate(withSetpointsFrom(p.graph, draft), inf);
  const currentPass = passes(p, now);
  const draftPass = passes(p, next);
  const changed = changedUnits(p.graph, draft);
  const removed = removedUnits(p.graph, draft);
  const piping = pipingChanged(p.graph, draft);

  const unitCharge = new Map<string, number>();
  if (next.ok) {
    for (const u of changed) {
      const prev = p.graph.nodes.find((b) => b.id === u.id);
      const c = u.kind === 'influent' ? Math.max(0, instCapex(u) - (prev ? instCapex(prev) : 0)) * RETROFIT_PREMIUM : unitRetrofitCharge(prev, u, next.nodes[u.id]?.capex ?? 0);
      unitCharge.set(u.id, c);
    }
  }
  const cost = Math.round([...unitCharge.values()].reduce((a, b) => a + b, 0));
  const nWorks = changed.length + removed.length;
  const weeks = nWorks ? 1 + Math.ceil(nWorks * 0.6) : piping ? 1 : 0;

  const errors: string[] = next.ok ? [] : next.errors.filter((e) => e.level === 'error').map((e) => e.text);
  if (!next.ok && !errors.length) errors.push('The upgraded design is incomplete.');
  if (!nWorks && !piping) errors.push('Nothing has changed from the as-built plant (set-points are changed in SCADA, not by works).');
  if (next.ok && !draftPass) errors.push(`The upgraded plant does not meet Standard ${p.standard} on today's influent.`);

  // ---- client scope, per unit
  const clientCharge = new Map<string, number>();
  const why: string[] = [];
  const recentFails = p.history.slice(-4).filter((h) => !h.pass).length;
  if (!currentPass && draftPass && recentFails >= COMPLIANCE_FAILS) {
    // units whose change is needed: revert (or bypass, if new) each one; if the draft then fails, it is in scope
    for (const u of changed) {
      const prev = p.graph.nodes.find((b) => b.id === u.id);
      const trial = prev ? { ...draft, nodes: draft.nodes.map((n) => (n.id === u.id ? { ...prev, params: { ...prev.params }, position: n.position } : n)) } : bypassUnit(draft, u.id);
      const needed = !trial || !passes(p, simulate(trial, inf));
      if (needed) clientCharge.set(u.id, unitCharge.get(u.id) ?? 0);
    }
    if (clientCharge.size) why.push(`the plant fails Standard ${p.standard} at today's load (${recentFails} of the last 4 samples failed) and these changes restore compliance`);
  }
  const used: string[] = [];
  const recent = (p.incidentLog ?? []).filter((x) => !x.used && week - x.week <= RELIABILITY_LOOKBACK_WEEKS);
  for (const u of changed) {
    if (clientCharge.has(u.id)) continue;
    const prev = p.graph.nodes.find((b) => b.id === u.id);
    const incidents = recent.filter((x) => x.unitId === u.id);
    if (!incidents.length || !prev) continue;
    const added = addedInstruments(prev, u);
    const remedies = new Set(incidents.flatMap((x) => (x.kind ? INCIDENT_REMEDY[x.kind] : added)));
    const keys = added.filter((k) => remedies.has(k));
    if (!keys.length) continue;
    // the remedial instruments only: their share of the unit's added-instrument charge
    const instAdded = Math.max(0, instCapex(u) - instCapex(prev));
    const remedial = Math.max(0, instCapex({ ...prev, inst: { ...prev.inst, ...Object.fromEntries(keys.map((k) => [k, true])) } }) - instCapex(prev));
    clientCharge.set(u.id, Math.min(unitCharge.get(u.id) ?? 0, Math.min(instAdded, remedial) * RETROFIT_PREMIUM));
    used.push(u.id);
  }
  if (used.length) why.push(`${used.map((id) => draft.nodes.find((n) => n.id === id)?.tag ?? id).join(', ')} had incidents in the last ${RELIABILITY_LOOKBACK_WEEKS} weeks that the added instruments remedy`);

  const clientCost = Math.round([...clientCharge.values()].reduce((a, b) => a + b, 0));
  const clientUnits = [...clientCharge.keys()].map((id) => draft.nodes.find((n) => n.id === id)?.tag ?? id);
  const clientFunded = clientCost > 0;
  const reason = clientFunded
    ? `Variation order for ${clientUnits.join(', ')}: ${why.join('; ')}. The rest of the works (${Math.round(cost - clientCost).toLocaleString()} RM) is operator-funded.`
    : !currentPass && draftPass && recentFails < COMPLIANCE_FAILS
      ? `Operator-funded: the plant would fail at today's load, but the client only orders works after failed samples (${recentFails} of the last 4; ${COMPLIANCE_FAILS} needed).`
      : 'Operator-funded: an improvement that pays back through lower running costs and fewer incidents.';
  return {
    ok: errors.length === 0,
    errors,
    cost,
    weeks,
    changed: changed.map((u) => u.tag ?? u.id),
    removed: removed.map((u) => u.tag ?? u.id),
    clientCost,
    clientUnits,
    clientFunded,
    price: Math.round(clientCost * VO_MARKUP),
    reason,
    currentPass,
    draftPass,
    usedIncidents: used,
  };
}

/**
 * Hand over completed upgrade works. The plant runs the new design with its live SCADA set-points; its asset value
 * (CAPEX, the maintenance base) is the upgraded plant's CAPEX — the rework premium is a sunk project cost. Only a
 * client-funded VO changes the O&M fee: re-priced on the new cost base (today's flow) at the contract margin and
 * escalation, up or down.
 */
export function completeUpgrade(p: Plant): Plant {
  const u = p.upgrade;
  if (!u || u.phase !== 'building') return p;
  const graph = withSetpointsFrom(u.graph, p.graph);
  const sim = simulate(graph, p.trueStream);
  const capex = sim.ok ? sim.capex : p.capex + (u.cost ?? 0);
  const keepRec = p.maintenanceBudget >= recommendedMaintenance(p.capex);
  let contract: OMContract | null = p.contract;
  if (contract && u.clientFunded) {
    const q = omFeeQuote({ capex, Q: currentInfluent(p).Q, std: p.standard, reputation: 0, opexRMd: sim.opexRMd, graph });
    const quote = { ...q, margin: contract.quote.margin, monthlyFee: Math.round((q.costBase * (1 + contract.quote.margin)) / 10) * 10 };
    contract = { ...contract, quote, monthlyFee: indexedFee(quote, contract.indexation ?? 1) };
  }
  return { ...p, graph, capex, maintenanceBudget: keepRec ? recommendedMaintenance(capex) : p.maintenanceBudget, contract, upgrade: null };
}
