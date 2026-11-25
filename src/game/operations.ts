/**
 * Operation & maintenance of commissioned plants. Each week every operated plant is simulated on that week's real
 * influent (with production growth and day-to-day variability), its current equipment condition and any breakdown.
 * A grab sample is checked against the discharge standard; non-compliance risks a DOE inspection fine.
 * Ref: knowledge/operations/om_model.md. All rates here are GAME MODEL values.
 */
import { Stream, cloneStream , mapInlets , totalQ } from '../simulation/core/stream';
import { CATALOGUE, Params, UnitType } from '../simulation/treatment/catalogue';
import { evaluate, limitsFor, StandardId } from '../simulation/treatment/compliance';
import { PNode, ProcessGraph, simulate } from '../simulation/treatment/graph';
import { IndustryId } from './industries';
import { Market, marketOpex } from './market';
import { commissioningInfluent } from './project';
import { createRng } from './rng';
import { Incident, IncidentKind, INCIDENT_LABEL, applyIncidentSteady, autoChangeover, incidentDisturbances, rollIncident } from './incidents';
import { hasInst } from '../simulation/treatment/instrumentation';
import { runDynamic } from '../simulation/dynamic/plantDynamics';
import type { PlantUpgrade } from './upgrade';

export const OM = {
  contractWeeks: 156,
  // ---- O&M contract: fixed monthly service fee + reimbursables (knowledge/operations/om_model.md, GAME MODEL, verify) ----
  /** plant operator basic salary, RM/month, and employer on-costs (EPF 13 %, SOCSO, EIS, leave, uniform/PPE) */
  operatorSalary: 3_500,
  onCost: 0.4,
  /** CePIETSO competent person (Environmental Quality (Industrial Effluent) Regulations 2009): part-time supervision */
  cepietsoSalary: 8_000,
  cepietsoFTE: 0.15,
  /** compliance sampling: accredited-lab price per parameter per weekly grab sample, RM */
  labPerParam: 25,
  /** contract management, insurance and head-office support, fraction of the direct cost base */
  managementFraction: 0.1,
  /** margin on the fixed-fee cost base: 125 % at reputation 0, ±25 points per 50 reputation, clamped 100–150 % */
  marginBase: 1.25,
  marginPerRep: 0.25 / 50,
  marginMin: 1.0,
  marginMax: 1.5,
  /** chemicals, power and sludge disposal are re-billed to the client at cost plus handling */
  handling: 0.1,
  /** fixed fee escalation each contract year */
  escalation: 0.04,
  /** performance deduction per failed weekly sample, fraction of the monthly fixed fee */
  deduction: 0.05,
  /** recommended maintenance = 2 % of CAPEX per year */
  maintenanceFraction: 0.02,
  wearPerWeek: 0.5,
  uncoveredWear: 0.7,
  /** customer production growth, fraction of flow per week, capped */
  growthPerWeek: 0.0015,
  growthCap: 1.3,
  inspectionChance: 0.2,
  /**
   * Random equipment breakdowns and process incidents. Switched OFF (user decision 2026-11-23: they made O&M unplayable).
   * The machinery (BREAKDOWNS, incidents.ts, SCADA field actions) is kept so it can return later as an opt-in setting.
   */
  randomFailures: false,
  /** chance per week of a process incident when none is active */
  incidentChance: 0.06,
  /** chance per week that a covering operator diagnoses an incident unaided */
  operatorFixChance: 0.25,
  /** Regulation 32: fine up to RM 100,000 */
  fineBase: 20_000,
  fineMax: 100_000,
  terminateBelow: 25,
  // ---- engineers on O&M (GAME MODEL, knowledge/operations/om_model.md "Engineers") ----
  /** plants one free engineer supervises as the CePIETSO competent person (part-time visits) — verify */
  plantsPerEngineer: 4,
  /** chance per week that the supervising engineer diagnoses and fixes an open incident on site */
  engineerFixChance: 0.5,
  /** SCADA field actions that miss the cause cost this fraction on an engineer-supervised plant (the engineer narrows the diagnosis) */
  engineerWrongActionFactor: 0.5,
  // ---- contract renewal (GAME MODEL, knowledge/operations/om_model.md "Renewal") ----
  /** the renewal is negotiated in the contract's last 13 weeks (3 months' notice) */
  renewalNoticeWeeks: 13,
  /** the client offers to renew only at or above this satisfaction */
  renewMinSatisfaction: 60,
  /** a counter-offer is accepted up to this premium over the client's offer, scaled from 0 at renewMinSatisfaction to the full premium at 100 % */
  counterMaxPremium: 0.2,
  // ---- stable plants (performance) ----
  /** consecutive compliant weeks, with no incident or breakdown, after which the steady result is reused */
  stableWeeks: 8,
  /** production growth since the last full simulation that forces a new one (fraction of flow) */
  stableFlowStep: 0.05,
};

export interface Breakdown {
  unitId: string;
  tag: string;
  description: string;
  weeksLeft: number;
}

export interface WeekRecord {
  week: number;
  pass: boolean;
  failed: string[];
  revenue: number;
  cost: number;
  condition: number;
  flowFactor: number;
  event?: string;
  fine?: number;
  /** an engineer supervised the plant this week (CePIETSO in-house, incidents diagnosed on site) */
  supervised?: boolean;
  /** revenue split (absent on old records): fixed fee, reimbursables billed, performance deduction */
  fee?: number;
  reimbursed?: number;
  deduction?: number;
  /** the plant was proven stable: last full simulation reused (no new simulation this week) */
  stable?: boolean;
  /** cost split, RM this week */
  costs?: { maintenance: number; repairs: number; opex: number; service: number; actions: number; fines: number };
}

export const WEEKS_PER_MONTH = 52 / 12;

/** Monthly fixed-fee build-up of an O&M offer (RM/month). */
export interface FeeQuote {
  operatorFTE: number;
  staffing: number;
  supervision: number;
  maintenance: number;
  lab: number;
  management: number;
  costBase: number;
  margin: number;
  monthlyFee: number;
  /** expected reimbursables (chemicals, power, sludge at cost + handling), RM/month at base prices */
  reimbursables: number;
}

export interface OMContract {
  /** current fixed service fee, RM/month (escalates yearly) */
  monthlyFee: number;
  quote: FeeQuote;
  startWeek: number;
  endWeek: number;
  /** cumulative escalation factor applied to the quote (1.04 per completed contract year) */
  indexation?: number;
  /** legacy (pre-2026-11-22) lump-sum contracts: replaced by a re-priced contract on load */
  weeklyFee?: number;
}

/** Renewal of an O&M contract: the client's offer and the outcome (both sides must agree). */
export interface RenewalOffer {
  offeredWeek: number;
  /** the client's offer, RM/month: the current fee escalated one more year */
  monthlyFee: number;
  weeks: number;
  status: 'offered' | 'accepted' | 'declined';
  /** the player has used the one counter-offer */
  countered?: boolean;
  /** fee both sides agreed, RM/month (accepted offers) */
  agreedFee?: number;
}

/** Last full weekly simulation of a stable plant, reused while nothing that matters changes. */
export interface SteadyCache {
  week: number;
  /** first week this design has been simulated without a break (the stable run must be on THIS design) */
  sinceWeek: number;
  graphKey: string;
  flowFactor: number;
  opexSplit: { chemicals: number; energy: number; sludge: number; credit?: number };
}

export interface Plant {
  id: string;
  company: string;
  industry: IndustryId;
  standard: StandardId;
  graph: ProcessGraph;
  trueStream: Stream;
  seed: number;
  capex: number;
  commissionedWeek: number;
  contract: OMContract | null;
  /** SCADA field-action costs booked since the last weekly record (shown in the plant's economics, already paid) */
  actionCost?: number;
  condition: number;
  maintenanceBudget: number;
  satisfaction: number;
  fines: number;
  breakdown: Breakdown | null;
  /** unresolved process incident (Phase 3 SCADA); absent on older saves */
  incident?: Incident | null;
  /** upgrade (variation order) being drafted in the Studio or under construction */
  upgrade?: PlantUpgrade | null;
  /** units that had process incidents (week, unit) — reliability upgrades on them are client-funded */
  incidentLog?: { week: number; unitId: string; kind?: IncidentKind; used?: boolean }[];
  history: WeekRecord[];
  status: 'operating' | 'handedOver' | 'terminated' | 'expired';
  /** renewal negotiation in the contract's final weeks (absent = none yet) */
  renewal?: RenewalOffer | null;
  /** the client was told it will not renew (unsatisfied) — sent once per contract */
  renewalRefusedWeek?: number;
  /** reused weekly simulation of a stable plant (absent/null = simulate) */
  steady?: SteadyCache | null;
}

/** The client's renewal offer: same terms for another contract period, the fixed fee escalated one more year. */
export function renewalOffer(p: Plant, week: number): RenewalOffer | null {
  if (!p.contract) return null;
  return { offeredWeek: week, monthlyFee: indexedFee(p.contract.quote, (p.contract.indexation ?? 1) * (1 + OM.escalation)), weeks: OM.contractWeeks, status: 'offered' };
}

/** Highest counter-offer fee the client accepts: up to +20 % on its offer for a fully satisfied client (GAME MODEL). */
export function counterCeiling(p: Plant, offer: RenewalOffer): number {
  const f = Math.max(0, Math.min(1, (p.satisfaction - OM.renewMinSatisfaction) / (100 - OM.renewMinSatisfaction)));
  return Math.round((offer.monthlyFee * (1 + OM.counterMaxPremium * f)) / 10) * 10;
}

/** Stable key of a process design (graph changes → a new full simulation). */
export function graphKey(g: ProcessGraph): string {
  const s = JSON.stringify({ n: g.nodes.map((x) => [x.id, x.kind, x.params, x.inst ?? null]), e: g.edges });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${s.length}`;
}

/** compliant weeks in a row at the end of the history, with no event */
function passStreak(h: WeekRecord[]): number {
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i].pass && !h[i].event; i--) n++;
  return n;
}

export function recommendedMaintenance(capex: number): number {
  return Math.round((capex * OM.maintenanceFraction) / 52);
}

/**
 * Operators needed (GAME MODEL, verify: day-shift plant with alarm call-out, not 24/7 manning): half a post below
 * 50 m³/d, one up to 300 m³/d, two above; +0.5 for an activated-sludge plant (daily DO/MLSS/SV30 checks, desludging,
 * weekend cover). Only units that are piped in count (an unconnected block is not built).
 */
export function operatorFTE(Q: number, graph?: ProcessGraph): number {
  const base = Q < 50 ? 0.5 : Q < 300 ? 1 : 2;
  const piped = (id: string) => !!graph?.edges.some((e) => e.from === id || e.to === id);
  return base + (graph?.nodes.some((n) => n.kind === 'activatedSludge' && piped(n.id)) ? 0.5 : 0);
}

/** Operator posts an operating plant needs: what its O&M contract bills (staffing matches the fee). */
export function plantPosts(p: Pick<Plant, 'contract' | 'trueStream' | 'graph'>): number {
  return p.contract?.quote.operatorFTE ?? operatorFTE(totalQ(p.trueStream), p.graph);
}

/** Number of parameters in the weekly compliance sample (everything the standard regulates). */
export function sampleParams(std: StandardId): number {
  return Object.keys(limitsFor(std)).length;
}

/** O&M margin on the cost base for the company's reputation. */
export function omMargin(reputation: number): number {
  return Math.min(OM.marginMax, Math.max(OM.marginMin, OM.marginBase + OM.marginPerRep * reputation));
}

/**
 * Fixed monthly service fee = (operators + CePIETSO supervision + maintenance + compliance sampling) × (1 + management)
 * × (1 + margin). Chemicals, power and sludge are not in it: they are re-billed at cost + handling.
 */
export function omFeeQuote(o: { capex: number; Q: number; std: StandardId; reputation: number; opexRMd: number; graph?: ProcessGraph }): FeeQuote {
  const fte = operatorFTE(o.Q, o.graph);
  const staffing = fte * OM.operatorSalary * (1 + OM.onCost);
  const supervision = OM.cepietsoFTE * OM.cepietsoSalary * (1 + OM.onCost);
  const maintenance = (o.capex * OM.maintenanceFraction) / 12;
  const lab = sampleParams(o.std) * OM.labPerParam * WEEKS_PER_MONTH;
  const direct = staffing + supervision + maintenance + lab;
  const management = direct * OM.managementFraction;
  const costBase = direct + management;
  const margin = omMargin(o.reputation);
  const r = (x: number) => Math.round(x);
  return {
    operatorFTE: fte,
    staffing: r(staffing),
    supervision: r(supervision),
    maintenance: r(maintenance),
    lab: r(lab),
    management: r(management),
    costBase: r(costBase),
    margin,
    monthlyFee: Math.round((costBase * (1 + margin)) / 10) * 10,
    reimbursables: r(((o.opexRMd * 365) / 12) * (1 + OM.handling)),
  };
}

export function contractFor(quote: FeeQuote, startWeek: number, weeks = OM.contractWeeks): OMContract {
  return { monthlyFee: quote.monthlyFee, quote, startWeek, endWeek: startWeek + weeks, indexation: 1 };
}

/** Fixed fee of a quote at a given escalation factor, RM/month. */
export function indexedFee(q: FeeQuote, indexation = 1): number {
  return Math.round((q.monthlyFee * indexation) / 10) * 10;
}

/**
 * The plant's own weekly service costs from the fee's cost base: CePIETSO supervision and compliance sampling,
 * escalated with the contract. Operators are on payroll; management is head-office overhead recovery (the company
 * already pays office overheads), so it is not charged again to the plant.
 */
export function weeklyServiceCost(q: FeeQuote, indexation = 1, inHouseCePIETSO = false): number {
  return (((inHouseCePIETSO ? 0 : q.supervision) + q.lab) * indexation) / WEEKS_PER_MONTH;
}

/** Instruments that would have prevented or contained each incident kind (for reliability variation orders). */
export const INCIDENT_REMEDY: Record<IncidentKind, string[]> = {
  pumpTrip: ['standby'],
  blowerTrip: ['standby'],
  probeDrift: [],
  toxicSlug: ['flow', 'level'],
  hydraulicSurge: ['flow', 'level'],
  bulking: ['doLoop'],
};

const BREAKDOWNS: Record<UnitType, { description: string; apply: (p: Params) => Params | 'bypass' }> = {
  eq: { description: 'EQ tank mixer failure — tank half-silted, little buffering', apply: (p) => ({ ...p, volume: Number(p.volume) * 0.3 }) },
  oilSep: { description: 'Oil skimmer failure — separator overloaded', apply: (p) => ({ ...p, area: Number(p.area) * 0.3 }) },
  daf: { description: 'DAF recycle pump / saturator failure — no micro-bubbles', apply: (p) => ({ ...p, recycle: 5, pressure: 200 }) },
  crReduction: { description: 'Metabisulfite dosing pump failure — no reduction', apply: () => 'bypass' },
  neutralisation: { description: 'pH dosing pump failure — no pH correction', apply: () => 'bypass' },
  precipitation: { description: 'Caustic dosing pump failure — no precipitation', apply: () => 'bypass' },
  sulfide: { description: 'NaHS dosing pump failure — no sulfide precipitation', apply: () => 'bypass' },
  ionExchange: { description: 'Resin bed exhausted early (regeneration valve stuck) — metals break through', apply: () => 'bypass' },
  electrowinning: { description: 'Rectifier trip — no metal plating', apply: () => 'bypass' },
  aop: { description: 'Peroxide dosing pump failure — no oxidation', apply: () => 'bypass' },
  uasb: { description: 'Granule washout after a shock load — reactor at a fraction of its capacity', apply: (p) => ({ ...p, volume: Number(p.volume) * 0.3 }) },
  mbr: { description: 'Membrane cassette fouled — taken out for chemical cleaning', apply: (p) => ({ ...p, area: Number(p.area) * 0.5 }) },
  uf: { description: 'UF train in clean-in-place — half the membrane area off line', apply: (p) => ({ ...p, area: Number(p.area) * 0.5 }) },
  ro: { description: 'RO high-pressure pump trip — feed bypasses the membranes', apply: () => 'bypass' },
  evaporator: { description: 'Vapour compressor trip — evaporator down', apply: () => 'bypass' },
  coagulation: { description: 'Coagulant dosing pump failure — no coagulation', apply: () => 'bypass' },
  clarifier: { description: 'Clarifier scraper drive failure — sludge blanket rising', apply: (p) => ({ ...p, area: Number(p.area) * 0.45 }) },
  activatedSludge: { description: 'Aeration blower failure — DO collapsed', apply: (p) => ({ ...p, do: 0.3 }) },
  sandFilter: { description: 'Filter backwash failure — bed clogged and short-circuiting', apply: (p) => ({ ...p, area: Number(p.area) * 0.35 }) },
  carbon: { description: 'Carbon bed exhausted — replacement delayed', apply: (p) => ({ ...p, ebct: Number(p.ebct) * 0.25 }) },
  thickener: { description: 'Thickener rake drive tripped — sludge blanket bridging, thin underflow', apply: (p) => ({ ...p, area: Number(p.area) * 0.4 }) },
  dryer: { description: 'Dryer burner / paddle drive tripped — wet cake bypassed to disposal', apply: () => 'bypass' },
  filterPress: { description: 'Filter press hydraulic pack failure — no dewatering', apply: () => 'bypass' },
  splitter: { description: 'Splitter gate jammed — all flow to one side', apply: (p) => ({ ...p, split: 100 }) },
  mixer: { description: 'Mixing box blocked with debris', apply: (p) => p },
};

/** Apply an active breakdown to the built graph (dosing failures bypass the unit; others degrade its parameters). */
export function degradedGraph(g: ProcessGraph, b: Breakdown | null): ProcessGraph {
  if (!b) return g;
  const node = g.nodes.find((n) => n.id === b.unitId);
  if (!node || node.kind === 'influent' || node.kind === 'discharge') return g;
  const eff = BREAKDOWNS[node.kind as UnitType].apply(node.params);
  // a bypassed unit stays in place as a pass-through, so flow splits elsewhere in the graph are unchanged
  return { ...g, nodes: g.nodes.map((n) => (n.id === node.id ? ({ ...n, ...(eff === 'bypass' ? { bypass: true } : { params: eff }) } as PNode) : n)) };
}

/** Effluent sample from a 0–36 h dynamic replay of the disturbed plant at hour tH. */
/** True if any pH or DO loop that the plant would normally have is not installed. */
export function runsManually(g: ProcessGraph): boolean {
  return g.nodes.some((n) => ((n.kind === 'neutralisation' || n.kind === 'precipitation') && !hasInst(n, 'pHLoop')) || (n.kind === 'activatedSludge' && !hasInst(n, 'doLoop')));
}

/** Grab sample from an undisturbed dynamic replay at hour tH (manual-control plants). */
export function routineGrabSample(g: ProcessGraph, inf: Stream, std: StandardId, tH: number, warmBase?: Stream): { pass: boolean; failed: string[] } {
  const r = runDynamic(g, inf, std, { hours: Math.ceil(tH + 1), disturbances: [], warmBase });
  const pt = r.points.reduce((b, x) => (Math.abs(x.t - tH) < Math.abs(b.t - tH) ? x : b), r.points[0]);
  return { pass: pt.pass, failed: pt.failed };
}

/**
 * Weekly grab sample of a manually controlled plant, from a cached 20 h dynamic replay (performance, GAME MODEL).
 * The replay depends on the design, the standard and the production level, not on the week: it runs once per plant
 * design and 5 % flow step (growth is 0.15 %/week, so about every 33 weeks) on the design influent scaled to that
 * flow; each week only picks its sampling hour. Weekly influent variability still enters through the steady
 * simulation, which the sample result is combined with. Before this the replay re-ran every week (~1.5 s per plant).
 */
const MANUAL_GRAB_CACHE = new Map<string, { t: number; pass: boolean; failed: string[] }[]>();
export function cachedManualGrab(p: Plant, flowFactor: number, tH: number): { pass: boolean; failed: string[] } {
  const step = Math.round(flowFactor / 0.05) * 0.05;
  const key = `${p.id}|${p.standard}|${step.toFixed(2)}|${JSON.stringify(p.graph.nodes)}|${JSON.stringify(p.graph.edges)}`;
  let pts = MANUAL_GRAB_CACHE.get(key);
  if (!pts) {
    const inf = cloneStream(p.trueStream);
    const g = mapInlets(inf, (x) => ({ ...x, Q: x.Q * step }));
    inf.Q = g.Q;
    inf.side = g.side;
    const r = runDynamic(p.graph, inf, p.standard, { hours: 20, disturbances: [], warmBase: p.trueStream });
    pts = r.points.map((x) => ({ t: x.t, pass: x.pass, failed: x.failed }));
    if (MANUAL_GRAB_CACHE.size > 64) MANUAL_GRAB_CACHE.delete(MANUAL_GRAB_CACHE.keys().next().value!);
    MANUAL_GRAB_CACHE.set(key, pts);
  }
  const pt = pts.reduce((b, x) => (Math.abs(x.t - tH) < Math.abs(b.t - tH) ? x : b), pts[0]);
  return { pass: pt.pass, failed: pt.failed };
}

export function incidentGrabSample(g: ProcessGraph, inf: Stream, std: StandardId, inc: Incident, tH: number, warmBase?: Stream): { pass: boolean; failed: string[] } {
  // warm state from the plant's design stream → cached across weeks (weekly influent noise does not force a new warm-up)
  const r = runDynamic(g, inf, std, { hours: Math.ceil(tH + 1), disturbances: incidentDisturbances(inc), warmBase });
  const pt = r.points.reduce((b, x) => (Math.abs(x.t - tH) < Math.abs(b.t - tH) ? x : b), r.points[0]);
  return { pass: pt.pass, failed: pt.failed };
}

export interface WeekOutcome {
  plant: Plant;
  cash: number;
  reputation: number;
  messages: string[];
}

/**
 * One week of O&M. `covered`: all operator posts staffed. `supervised`: one of the company's free engineers is the
 * plant's CePIETSO competent person — no external supervision cost, and incidents are diagnosed on site.
 */
export function operateWeek(plant: Plant, week: number, market: Market, covered: boolean, supervised = false): WeekOutcome {
  const rng = createRng(plant.seed * 131 + week);
  const p: Plant = { ...plant, history: [...plant.history] };
  const messages: string[] = [];
  let reputation = 0;
  let cost = 0;
  let event: string | undefined;

  const costs = { maintenance: 0, repairs: 0, opex: 0, service: 0, actions: p.actionCost ?? 0, fines: 0 };
  p.actionCost = 0;

  // 0. contract-year escalation of the fixed fee (not in the contract's final week)
  if (p.contract && week > p.contract.startWeek && week < p.contract.endWeek && (week - p.contract.startWeek) % 52 === 0) {
    const indexation = (p.contract.indexation ?? 1) * (1 + OM.escalation);
    p.contract = { ...p.contract, indexation, monthlyFee: indexedFee(p.contract.quote, indexation) };
    messages.push(`${p.company}: contract anniversary — fixed fee escalated ${Math.round(OM.escalation * 100)} % to RM ${p.contract.monthlyFee.toLocaleString()}/month.`);
  }

  // 1. equipment condition
  const rec = recommendedMaintenance(p.capex);
  const care = rec > 0 ? p.maintenanceBudget / rec : 1;
  p.condition = Math.max(0, Math.min(100, p.condition - OM.wearPerWeek - (covered ? 0 : OM.uncoveredWear) + 0.9 * Math.min(care, 2)));
  cost += p.maintenanceBudget;
  costs.maintenance = p.maintenanceBudget;
  // CePIETSO supervision and weekly compliance sampling (operators are on payroll, management is overhead recovery)
  if (p.contract) {
    // an in-house engineer as CePIETSO replaces the external part-time supervisor; sampling is still bought in
    costs.service = weeklyServiceCost(p.contract.quote, p.contract.indexation ?? 1, supervised);
    cost += costs.service;
  }

  // 2. breakdowns
  if (p.breakdown) {
    p.breakdown = p.breakdown.weeksLeft > 1 ? { ...p.breakdown, weeksLeft: p.breakdown.weeksLeft - 1 } : null;
  } else if (OM.randomFailures) {
    const chance = 0.01 + (100 - p.condition) * 0.0006;
    if (rng.chance(chance)) {
      const units = p.graph.nodes.filter((n) => n.kind !== 'influent' && n.kind !== 'discharge');
      if (units.length) {
        const u = rng.pick(units);
        const def = BREAKDOWNS[u.kind as UnitType];
        const weeks = 1 + (rng.chance(0.4) ? 1 : 0) + (covered ? 0 : 1);
        const unitCapex = CATALOGUE[u.kind as UnitType] ? p.capex / units.length : 0;
        const repair = Math.round(unitCapex * rng.range(0.005, 0.015));
        cost += repair;
        costs.repairs += repair;
        p.breakdown = { unitId: u.id, tag: u.tag ?? u.kind, description: def.description, weeksLeft: weeks };
        event = `${u.tag}: ${def.description} (repair RM ${repair.toLocaleString()}, ${weeks} wk)`;
        messages.push(`${p.company} — ${event}`);
      }
    }
  }

  // 2b. process incidents (diagnosed and fixed in SCADA; an operator may eventually fix it unaided)
  if (p.incident) {
    if (covered && week > p.incident.startWeek && rng.chance(OM.operatorFixChance)) {
      messages.push(`${p.company} — operators traced and fixed the ${INCIDENT_LABEL[p.incident.kind].toLowerCase()} at ${p.incident.tag}.`);
      p.incident = null;
    } else if (supervised && week > p.incident.startWeek && rng.chance(OM.engineerFixChance)) {
      messages.push(`${p.company} — the supervising engineer diagnosed and fixed the ${INCIDENT_LABEL[p.incident.kind].toLowerCase()} at ${p.incident.tag} on site.`);
      p.incident = null;
    }
  } else if (OM.randomFailures && !p.breakdown && rng.chance(OM.incidentChance)) {
    p.incident = rollIncident(p.graph, week, rng);
    // an incident the standby absorbed is not a reliability problem; the rest are logged for variation orders
    if (p.incident?.unitId && !autoChangeover(p.graph, p.incident)) p.incidentLog = [...(p.incidentLog ?? []), { week, unitId: p.incident.unitId, kind: p.incident.kind }].slice(-30);
    if (p.incident && autoChangeover(p.graph, p.incident)) {
      const tag = p.incident.tag;
      messages.push(`${p.company} — ${INCIDENT_LABEL[p.incident.kind]} at ${tag}: standby took over automatically. Duty unit repaired (RM 500).`);
      cost += 500;
      costs.repairs += 500;
      event = event ?? `Auto-changeover at ${tag}`;
      p.incident = null;
    }
    if (p.incident) {
      event = event ?? `Alarm: ${p.incident.symptoms[0]}`;
      messages.push(`${p.company} — SCADA alarm: ${p.incident.symptoms[0]}. Open SCADA to diagnose.`);
    }
  }

  // 3. this week's influent: production growth + variability
  const flowFactor = Math.min(OM.growthCap, 1 + OM.growthPerWeek * (week - p.commissionedWeek));
  const inf = cloneStream(commissioningInfluent(p.trueStream, p.seed * 97 + week));
  const infG = mapInlets(inf, (x) => ({ ...x, Q: x.Q * flowFactor }));
  inf.Q = infG.Q;
  inf.side = infG.side;
  // A plant that has passed every weekly sample for OM.stableWeeks with no incident or breakdown is proven on this
  // feed: its last full simulation is reused (running costs scaled with flow, sample compliant) until the design
  // changes, production grows another 5 %, or something goes wrong (GAME MODEL, performance — om_model.md).
  const key = graphKey(p.graph);
  const st = p.steady;
  const stable = !!st && st.graphKey === key && !p.incident && !p.breakdown && Math.abs(flowFactor - st.flowFactor) < OM.stableFlowStep && passStreak(p.history) >= OM.stableWeeks && week - st.sinceWeek >= OM.stableWeeks;
  let pass: boolean;
  let failed: string[];
  let simOk = true;
  if (stable && st) {
    const k = flowFactor / st.flowFactor;
    const split = { chemicals: st.opexSplit.chemicals * k, energy: st.opexSplit.energy * k, sludge: st.opexSplit.sludge * k, credit: (st.opexSplit.credit ?? 0) * k };
    costs.opex = 7 * marketOpex(split, market);
    pass = true;
    failed = [];
  } else {
    const disturbed = applyIncidentSteady(degradedGraph(p.graph, p.breakdown), inf, p.incident ?? null);
    const sim = simulate(disturbed.graph, disturbed.influent);
    simOk = sim.ok;
    costs.opex = sim.ok ? 7 * marketOpex(sim.opexSplit, market) : 0;
    // 4. grab sample and compliance
    const report = sim.effluent ? evaluate(sim.effluent, p.standard, sim) : null;
    pass = !!report?.pass;
    failed = report ? report.checks.filter((c) => !c.pass).map((c) => c.param) : ['no effluent'];
    p.steady = sim.ok && !p.incident && !p.breakdown ? { week, sinceWeek: st && st.graphKey === key ? st.sinceWeek : week, graphKey: key, flowFactor, opexSplit: { ...sim.opexSplit } } : null;
  }
  cost += costs.opex;
  if (!stable && !p.incident && !p.breakdown && simOk && runsManually(p.graph)) {
    // loops without instruments run on a fixed manual setting: the grab sample catches the plant at a random hour,
    // with the daily production swing, from the dynamic replay (knowledge/operations/instrumentation.md)
    // shorter replay (≤ 20 h) keeps weekly simulation light; warm state is cached on the design stream
    const g = cachedManualGrab(p, flowFactor, rng.range(6, 19));
    pass = g.pass && pass;
    failed = [...new Set([...failed, ...g.failed])];
  }
  if (p.incident && simOk) {
    // During an incident the grab sample is taken from the dynamic plant (ASM1, PI loops) at a random hour of the
    // disturbed day: the steady models cannot represent oxygen-supply or settling failures (knowledge/operations/scada.md).
    // the dynamic sample REPLACES the steady one (it already contains the breakdown and the incident)
    const g = incidentGrabSample(degradedGraph(p.graph, p.breakdown), inf, p.standard, p.incident, rng.range(10, 30), p.trueStream);
    pass = g.pass;
    failed = g.failed;
  }
  let fine: number | undefined;
  if (pass) {
    p.satisfaction = Math.min(100, p.satisfaction + 1);
  } else {
    p.satisfaction = Math.max(0, p.satisfaction - 6);
    if (rng.chance(OM.inspectionChance)) {
      fine = Math.min(OM.fineMax, OM.fineBase * (1 + 0.5 * p.fines));
      p.fines += 1;
      cost += fine;
      costs.fines = fine;
      reputation -= 8;
      messages.push(`DOE inspection at the treatment plant you operate for ${p.company}: your plant's effluent is non-compliant (${failed.join(', ')}). Compound fine RM ${fine.toLocaleString()}, −8 reputation.`);
    }
  }

  // revenue: weekly share of the fixed monthly fee, less a performance deduction on a failed sample,
  // plus chemicals/power/sludge re-billed at actual cost + handling
  const fee = p.contract ? p.contract.monthlyFee / WEEKS_PER_MONTH : 0;
  const deduction = p.contract && !pass ? p.contract.monthlyFee * OM.deduction : 0;
  const reimbursed = p.contract ? costs.opex * (1 + OM.handling) : 0;
  if (deduction) messages.push(`Your plant for ${p.company}: failed sample — performance deduction RM ${Math.round(deduction).toLocaleString()} from the service fee.`);
  const revenue = fee - deduction + reimbursed;
  // field-action costs were paid when taken (ledger); they are shown in this week's plant costs but not charged again
  if (!pass) p.steady = null; // a failed sample ends the stable run: simulate again from next week
  p.history = [...p.history, { week, pass, failed, revenue, cost: cost + costs.actions, condition: p.condition, flowFactor, event, fine, fee, reimbursed, deduction, costs, supervised, ...(stable ? { stable: true } : {}) }].slice(-52);

  // 5. contract lifecycle
  if (p.contract && p.satisfaction < OM.terminateBelow) {
    p.status = 'terminated';
    p.contract = null;
    reputation -= 15;
    messages.push(`O&M contract for ${p.company} terminated after your plant's repeated non-compliance (−15 reputation).`);
  } else if (p.contract && week >= p.contract.endWeek) {
    const r = p.renewal;
    if (r?.status === 'accepted' && r.agreedFee) {
      // renewed: a new contract period on the agreed fee (escalation restarts from it)
      const quote = { ...p.contract.quote, monthlyFee: r.agreedFee };
      p.contract = contractFor(quote, p.contract.endWeek, r.weeks);
      p.renewal = null;
      p.renewalRefusedWeek = undefined;
      if (p.satisfaction >= 70) reputation += 5;
      messages.push(`O&M contract with ${p.company} renewed for ${Math.round(r.weeks / 52)} years at RM ${r.agreedFee.toLocaleString()}/month${p.satisfaction >= 70 ? ' (+5 reputation)' : ''}.`);
    } else {
      p.status = 'expired';
      p.contract = null;
      p.renewal = null;
      if (p.satisfaction >= 70) {
        reputation += 5;
        messages.push(`O&M contract with ${p.company} completed with a satisfied client (+5 reputation)${r?.status === 'declined' ? ' — not renewed' : ''}.`);
      } else messages.push(`O&M contract with ${p.company} ended.`);
    }
  } else if (p.contract && week >= p.contract.endWeek - OM.renewalNoticeWeeks && !p.renewal) {
    // renewal window: a satisfied client offers to renew; an unsatisfied one says so (it may still offer if things improve)
    if (p.satisfaction >= OM.renewMinSatisfaction) {
      p.renewal = renewalOffer(p, week);
      messages.push(`${p.company} offers to renew the O&M contract for 3 more years at RM ${p.renewal!.monthlyFee.toLocaleString()}/month (expires week ${p.contract.endWeek}). Answer in Plants & O&M.`);
    } else if (p.renewalRefusedWeek === undefined) {
      p.renewalRefusedWeek = week;
      messages.push(`${p.company} does not plan to renew the O&M contract (satisfaction ${Math.round(p.satisfaction)} %, needs ${OM.renewMinSatisfaction} %). Keep the plant compliant — it may still offer before week ${p.contract.endWeek}.`);
    }
  }
  return { plant: p, cash: revenue - cost, reputation, messages };
}
