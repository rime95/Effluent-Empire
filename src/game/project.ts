/** Project lifecycle: design → commission → (pass → paid) | (fail → retrofit | abandon). Pure functions. */
import { Stream, METALS, cloneStream, codTotal, tss, metalTotal } from '../simulation/core/stream';
import { setCbForPH } from '../simulation/chemistry/acidBase';
import { CATALOGUE, defaultParams } from '../simulation/treatment/catalogue';
import { ComplianceReport, evaluate } from '../simulation/treatment/compliance';
import { PNode, ProcessGraph, simulate } from '../simulation/treatment/graph';
import { Note } from '../simulation/treatment/types';
import { Enquiry, PAYMENT } from './customers';
import { Datasheet, LabTestId } from './lab';
import { createRng } from './rng';
import type { FeeQuote } from './operations';

export type ProjectStatus = 'design' | 'building' | 'failed' | 'completed' | 'abandoned';

export interface StageRow {
  tag: string;
  name: string;
  pH: number;
  COD: number;
  TSS: number;
  Ni: number;
  Cu: number;
  Zn: number;
  OG: number;
  notes: Note[];
}

export interface CommissionReport {
  week: number;
  attempt: number;
  pass: boolean;
  compliance: ComplianceReport;
  stages: StageRow[];
  capexCharged: number;
  totalCapex: number;
  opexRMd: number;
  /** mechanical-completion milestone released on this attempt (first build only) */
  milestone: number;
  /** retention released on acceptance, net of liquidated damages */
  payment: number;
  lateWeeks: number;
  reputationDelta: number;
  messages: string[];
  errors: Note[];
}

export interface Project {
  enquiry: Enquiry;
  startedWeek: number;
  datasheet: Datasheet;
  testsDone: LabTestId[];
  graph: ProcessGraph;
  built: ProcessGraph | null;
  spent: { lab: number; capex: number };
  /** contract payments received so far, RM */
  paid: number;
  attempts: number;
  status: ProjectStatus;
  reports: CommissionReport[];
  /** stable id (enquiry id) */
  id: string;
  /** lab tests in progress */
  labQueue: { test: LabTestId; doneWeek: number }[];
  /** construction in progress: the commissioning outcome is fixed when work starts and revealed at doneWeek */
  /** under construction. `progress` (new saves): CAPEX is paid and the client's 60 % progress claims are received weekly
   *  over the build (industry practice); legacy saves without it paid CAPEX up front and get the 60 % at completion. */
  building: { doneWeek: number; report: CommissionReport; graph: ProcessGraph; progress?: { capexPerWeek: number; claimPerWeek: number; weeksLeft: number } } | null;
  /** O&M contract offered after a successful commissioning */
  /** O&M offer after a passed commissioning: fixed monthly fee build-up + reimbursables (operations.ts omFeeQuote) */
  omOffer: { quote: FeeQuote; weeks: number; weeklyFee?: number } | null;
}

export function starterGraph(): ProcessGraph {
  return {
    nodes: [
      { id: 'in', kind: 'influent', tag: 'RAW', params: {} },
      { id: 'out', kind: 'discharge', tag: 'OUT', params: {} },
    ],
    edges: [],
  };
}

export function newProject(e: Enquiry, week: number): Project {
  return { id: e.id, enquiry: e, startedWeek: week, datasheet: { ...e.declared }, testsDone: [], graph: starterGraph(), built: null, spent: { lab: 0, capex: 0 }, paid: 0, attempts: 0, status: 'design', reports: [], labQueue: [], building: null, omOffer: null };
}

export function makeNode(kind: PNode['kind'], Q: number, existing: PNode[]): PNode {
  if (kind === 'influent' || kind === 'discharge') throw new Error('terminal nodes are fixed');
  if (kind === 'disposal') {
    const count = existing.filter((n) => n.kind === 'disposal').length + 1;
    return { id: `disposal-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, kind, tag: `SD-${String(count).padStart(2, '0')}`, params: {} };
  }
  const def = CATALOGUE[kind];
  const count = existing.filter((n) => n.kind === kind).length + 1;
  const id = `${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  return { id, kind, tag: `${def.tagPrefix}-${String(count).padStart(2, '0')}`, params: defaultParams(kind, Q) };
}

const sameNode = (a: PNode, b: PNode) => a.kind === b.kind && JSON.stringify(a.params) === JSON.stringify(b.params);

/** Day-to-day variability of the real influent at commissioning (GAME MODEL ±8 %). */
export function commissioningInfluent(trueS: Stream, seed: number): Stream {
  const rng = createRng(seed);
  const s = cloneStream(trueS);
  const v = (x: number) => rng.noise(x, 0.08);
  s.SS = v(s.SS);
  s.SI = v(s.SI);
  s.XS = v(s.XS);
  s.XI = v(s.XI);
  for (const m of METALS) s.dissolved[m] = v(s.dissolved[m]);
  s.colloid = v(s.colloid);
  s.OGfree = v(s.OGfree);
  s.OGemulsified = v(s.OGemulsified);
  s.NH4N = v(s.NH4N);
  return setCbForPH(s, trueS.pH + rng.range(-0.15, 0.15));
}

export const LD_RATE_PER_WEEK = 0.01;
export const ABANDON_PENALTY = 0.15;
export const RETROFIT_PREMIUM = 1.2;

export function constructionWeeks(p: Project): number {
  // units with no pipes are left out of the design (see simulate) and are not built
  const units = p.graph.nodes.filter((n) => n.kind !== 'influent' && n.kind !== 'discharge' && p.graph.edges.some((e) => e.from === n.id || e.to === n.id));
  if (!p.built) return 2 + Math.ceil(units.length * 0.8);
  const builtNodes = p.built.nodes;
  const changed = units.filter((u) => !builtNodes.some((b) => b.id === u.id && sameNode(b, u))).length;
  return 1 + Math.ceil(changed * 0.6);
}

export function commission(p: Project, week: number): CommissionReport {
  const e = p.enquiry;
  const influent = commissioningInfluent(e.trueStream, e.seed * 31 + p.attempts + 1);
  const sim = simulate(p.graph, influent);
  const messages: string[] = [];
  // CAPEX actually charged: full on first build; on retrofit, new or modified units at a 20 % rework premium
  let capexCharged = sim.capex;
  if (p.built) {
    capexCharged = 0;
    for (const id of Object.keys(sim.nodes)) {
      const n = sim.nodes[id];
      const prev = p.built.nodes.find((b) => b.id === id);
      if (!prev || !sameNode(prev, n.node)) capexCharged += n.capex * RETROFIT_PREMIUM;
    }
  }
  const stages: StageRow[] = sim.order
    .filter((id) => sim.nodes[id])
    .map((id) => {
      const n = sim.nodes[id];
      const o = n.result.out;
      return { tag: n.node.tag ?? id, name: CATALOGUE[n.node.kind as keyof typeof CATALOGUE].name, pH: o.pH, COD: codTotal(o), TSS: tss(o), Ni: metalTotal(o, 'Ni'), Cu: metalTotal(o, 'Cu'), Zn: metalTotal(o, 'Zn'), OG: o.OGfree + o.OGemulsified, notes: n.result.notes };
    });
  if (!sim.effluent) {
    return { week, attempt: p.attempts + 1, pass: false, compliance: { standard: e.standard, version: '', pass: false, checks: [] }, stages, capexCharged: 0, totalCapex: 0, opexRMd: 0, milestone: 0, payment: 0, lateWeeks: 0, reputationDelta: 0, messages: ['Design is incomplete.'], errors: sim.errors };
  }
  const compliance = evaluate(sim.effluent, e.standard, sim);
  const deadline = p.startedWeek + e.deadlineWeeks;
  const lateWeeks = Math.max(0, week - deadline);
  let rep = 0;
  let payment = 0;
  if (compliance.pass) {
    const ld = Math.min(0.2, lateWeeks * LD_RATE_PER_WEEK) * e.contractValue;
    payment = e.contractValue * PAYMENT.retention - ld;
    rep += 10;
    messages.push('Commissioning passed: plant meets ' + (e.standard === 'A' ? 'Standard A' : 'Standard B') + ' (+10 reputation).');
    if (e.standard === 'A') {
      rep += 10;
      messages.push('Standard A project delivered (+10).');
    }
    const totalCapex = p.spent.capex + capexCharged;
    if (totalCapex <= 0.6 * e.contractValue) {
      rep += 5;
      messages.push('Delivered with a healthy margin (+5).');
    }
    if (sim.opexRMd > e.opexLimitRMd) {
      rep -= 5;
      messages.push(`Operating cost RM ${sim.opexRMd.toFixed(0)}/d exceeds the customer's RM ${e.opexLimitRMd}/d expectation (−5).`);
    }
    if (p.attempts > 0) {
      rep -= 3 * p.attempts;
      messages.push(`${p.attempts} failed commissioning attempt(s) before success (−${3 * p.attempts}).`);
    }
    if (lateWeeks > 0) {
      rep -= 2 * lateWeeks;
      messages.push(`${lateWeeks} week(s) late: liquidated damages RM ${ld.toFixed(0)} (−${2 * lateWeeks} reputation).`);
    }
  } else {
    rep -= 5;
    messages.push('Commissioning failed the discharge test (−5 reputation). Retrofit the design or abandon the project.');
  }
  const milestone = p.built ? 0 : e.contractValue * PAYMENT.mechanicalCompletion;
  return { week, attempt: p.attempts + 1, pass: compliance.pass, compliance, stages, capexCharged, totalCapex: p.spent.capex + capexCharged, opexRMd: sim.opexRMd, milestone, payment, lateWeeks, reputationDelta: rep, messages, errors: sim.errors };
}
