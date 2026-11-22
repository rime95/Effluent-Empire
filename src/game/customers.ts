/**
 * Enquiry generation. Deterministic from a seed.
 * Tender price = CAPEX of a competent reference design for this wastewater × market markup (GAME MODEL),
 * so contract value follows the same economies of scale as construction cost.
 */
import { Stream } from '../simulation/core/stream';
import { StandardId } from '../simulation/treatment/compliance';
import { linearGraph, simulate } from '../simulation/treatment/graph';
import { INDUSTRIES, IndustryId, generateWastewater } from './industries';
import { Datasheet, declaredDatasheet } from './lab';
import { REFERENCE } from './referenceDesigns';
import { Rng, createRng } from './rng';
import { TechId } from './tech';
import { Requirements } from './requirements';
import { ClientVariant, VARIANTS, VARIANT_CHANCE, VARIANT_PREMIUM, eligibleVariants } from './variants';
import { ClientTier, REAL_CLIENTS } from './realClients';
import { evaluate } from '../simulation/treatment/compliance';
import { ProcessGraph, SimResult } from '../simulation/treatment/graph';
import { evaluateRequirements } from './requirements';
import { TrainSpec, reuseGraph, zldGraph } from './referenceDesigns';

export interface Enquiry {
  id: string;
  seed: number;
  company: string;
  industry: IndustryId;
  standard: StandardId;
  /** design-and-build lump sum, RM */
  contractValue: number;
  /** maximum operating cost the customer will accept, RM/d */
  opexLimitRMd: number;
  deadlineWeeks: number;
  difficult: boolean;
  declared: Datasheet;
  /** hidden from the player */
  trueStream: Stream;
  hidden: { undeclaredZn: boolean; undeclaredCrVI: boolean };
  postedWeek: number;
  expiresWeek: number;
  /** tough job opened by a researched technology (variants.ts) */
  variant?: { id: string; label: string; brief: string };
  /** contract requirements beyond the discharge standard (requirements.ts) */
  requirements?: Requirements;
  /** client tier (missing = basic, legacy saves) */
  tier?: ClientTier;
}

/**
 * Client tiers (GAME MODEL, knowledge/processes/client_tiers.md). Medium: large local companies; MNC: multinationals.
 * Bigger budgets, stricter contracts. Drawn from an independent RNG stream so the base enquiry for a seed is unchanged.
 */
export const TIERS = {
  medium: { reputation: 25, chance: 0.3, valueMult: 1.8, opexMult: 1.5 },
  /** needs the water reclaim system researched: MNC contracts carry a reuse target */
  mnc: { reputation: 50, tech: 'reclaim' as TechId, chance: 0.25, valueMult: 3, opexMult: 3, reuseSplits: [70, 50, 35] },
} as const;

export function eligibleTiers(reputation: number, tech: readonly TechId[]): ClientTier[] {
  const t: ClientTier[] = [];
  if (reputation >= TIERS.medium.reputation) t.push('medium');
  if (reputation >= TIERS.mnc.reputation && tech.includes(TIERS.mnc.tech)) t.push('mnc');
  return t;
}

/** every unit that can take a standby machine gets one (tier client reference designs) */
function withStandby(g: ProcessGraph): ProcessGraph {
  for (const n of g.nodes) n.inst = { ...n.inst, standby: true };
  return g;
}

export interface TierDesign {
  tier: ClientTier;
  graph: ProcessGraph;
  ref: SimResult;
  requirements: Requirements;
  /** strictest standard the reference design meets (undefined: none — keep the drawn standard) */
  standard?: StandardId;
}

/**
 * The tier client's contract, set like a feasibility study would: the strictest target the reference design actually
 * reaches on this feed. MNC: ZLD (platers, once the evaporator is researched, half of them), else the largest reuse
 * share of 70 / 50 / 35 % of the flow through UF + RO whose brine blend still meets a standard; an MNC whose feed allows
 * none of these is offered as a medium-tier job. Medium: Standard A where reachable, duty/standby everywhere.
 * reuseMin = split × UF recovery (0.92) × RO recovery (0.75) × 0.95 margin, rounded down to 5 %.
 */
export function tierDesign(tier: Exclude<ClientTier, 'basic'>, industry: IndustryId, s: Stream, tech: readonly TechId[], seed: number): TierDesign {
  const train = REFERENCE[industry](s);
  const Q = s.Q;
  const cands: { tier: ClientTier; graph: () => ProcessGraph; req: Requirements }[] = [];
  if (tier === 'mnc') {
    if (industry === 'plating' && tech.includes('evaporator') && createRng(seed * 104729 + 97).chance(0.5)) cands.push({ tier, graph: () => zldGraph(train, Q), req: { zld: true, standby: true } });
    for (const split of TIERS.mnc.reuseSplits)
      cands.push({ tier, graph: () => reuseGraph(train, Q, split), req: { reuseMin: Math.floor((split * 0.92 * 0.75 * 0.95) / 5) * 5 / 100, standby: true } });
  }
  cands.push({ tier: 'medium', graph: () => linearGraph(train), req: { standby: true } });
  let last: TierDesign | undefined;
  for (const c of cands) {
    const graph = withStandby(c.graph());
    const ref = simulate(graph, s);
    const std: StandardId | undefined = !ref.effluent ? undefined : evaluate(ref.effluent, 'A', ref).pass ? 'A' : evaluate(ref.effluent, 'B', ref).pass ? 'B' : undefined;
    last = { tier: c.tier, graph, ref, requirements: c.req, standard: std };
    if (std && evaluateRequirements(ref, c.req).every((r) => r.pass)) return last;
  }
  return last!;
}

export interface EnquiryOptions {
  /** researched technologies; undefined = legacy generation (no tough jobs) */
  tech?: readonly TechId[];
  /** company names already in play (open enquiries, projects, plants): not reused */
  usedNames?: ReadonlySet<string>;
  /** developer mode: force the industry, a variant or a tier */
  force?: { industry?: IndustryId; variantId?: string; tier?: ClientTier };
}

/**
 * Company name: one RNG draw (so the rest of the enquiry is unchanged), then the next unused name in the list if the
 * drawn one is already in play.
 */
function pickName(names: readonly string[], rng: Rng, used?: ReadonlySet<string>): string {
  const i0 = Math.floor(rng.next() * names.length);
  if (!used) return names[i0];
  for (let k = 0; k < names.length; k++) {
    const n = names[(i0 + k) % names.length];
    if (!used.has(n)) return n;
  }
  return `${names[i0]} (second site)`;
}

/** Milestone payment schedule (typical design-and-build terms). */
export const PAYMENT = { advance: 0.3, mechanicalCompletion: 0.6, retention: 0.1 };

export function generateEnquiry(seed: number, week: number, reputation: number, opts: EnquiryOptions = {}): Enquiry {
  const rng = createRng(seed);
  // early game: no semiconductor until some reputation is earned
  const pool: IndustryId[] = reputation >= 40 ? ['plating', 'food', 'semiconductor'] : ['plating', 'food'];
  const drawn = rng.pick(pool);
  const forcedVariant = opts.force?.variantId ? VARIANTS.find((v) => v.id === opts.force!.variantId) : undefined;
  const industry: IndustryId = forcedVariant?.industry ?? opts.force?.industry ?? drawn;
  const t = INDUSTRIES[industry];
  // project size grows with reputation: a new consultancy only gets the smaller jobs
  const sizeFrac = Math.min(1, 0.35 + Math.max(0, reputation) / 100);
  const template = { ...t, Q: [t.Q[0], t.Q[0] + (t.Q[1] - t.Q[0]) * sizeFrac] as [number, number] };
  const ww = generateWastewater(template, rng);
  let standard: StandardId = rng.chance(0.2 + Math.min(0.3, Math.max(0, reputation) / 400)) ? 'A' : 'B';
  const difficult = rng.chance(0.2);

  // client tier: its own RNG stream (base enquiry unchanged); a tier client is not also a tough-job variant
  let tier: ClientTier = 'basic';
  if (opts.force?.tier) tier = opts.force.tier;
  else if (opts.tech && !forcedVariant) {
    const tr = createRng(seed * 104729 + 31);
    const open = eligibleTiers(reputation, opts.tech);
    if (open.includes('mnc') && tr.chance(TIERS.mnc.chance)) tier = 'mnc';
    else if (open.includes('medium') && tr.chance(TIERS.medium.chance)) tier = 'medium';
  }

  // tough job: an independent RNG stream, so the base enquiry for this seed is unchanged
  let variant: ClientVariant | undefined = forcedVariant;
  if (variant) {
    ww.stream = variant.overlay(ww.stream, createRng(seed * 7919 + 17));
    if (variant.standard) standard = variant.standard;
  } else if (opts.tech && tier === 'basic') {
    const vr = createRng(seed * 7919 + 17);
    const open = eligibleVariants(industry, opts.tech);
    if (open.length && vr.chance(VARIANT_CHANCE)) {
      variant = vr.pick(open);
      ww.stream = variant.overlay(ww.stream, vr);
      if (variant.standard) standard = variant.standard;
    }
  }
  let ref: SimResult;
  let requirements: Requirements | undefined;
  if (tier !== 'basic') {
    const pick = tierDesign(tier, industry, ww.stream, opts.tech ?? [], seed);
    ({ tier, ref, requirements } = pick);
    if (pick.standard) standard = pick.standard;
  } else {
    const refDesign: TrainSpec | ProcessGraph = variant ? variant.reference(ww.stream) : REFERENCE[industry](ww.stream);
    ref = simulate(Array.isArray(refDesign) ? linearGraph(refDesign) : refDesign, ww.stream);
    requirements = variant?.requirements?.(ref);
  }
  const markup = rng.range(1.35, 1.6);
  const repFactor = 1 + Math.min(0.15, Math.max(-0.15, reputation / 600));
  const tierMult = tier === 'basic' ? { valueMult: 1, opexMult: 1 } : TIERS[tier];
  const contractValue = Math.round((ref.capex * markup * (standard === 'A' ? 1.25 : 1) * repFactor * (difficult ? 0.88 : 1) * (variant ? VARIANT_PREMIUM : 1) * tierMult.valueMult) / 1000) * 1000;
  const names = tier === 'basic' ? t.names : REAL_CLIENTS[tier][industry];

  return {
    id: `E${seed}`,
    seed,
    company: pickName(names, rng, opts.usedNames),
    industry,
    standard,
    contractValue,
    // customer's OPEX expectation: generous vs the reference design so sludge, instruments and safety margins fit (GAME MODEL)
    opexLimitRMd: Math.round((ref.opexRMd * rng.range(1.8, 2.5) + 80) * tierMult.opexMult),
    deadlineWeeks: difficult ? rng.int(9, 12) : rng.int(13, 18),
    difficult,
    declared: declaredDatasheet(ww.stream, rng, ww.hidden.undeclaredZn, ww.hidden.undeclaredCrVI),
    trueStream: ww.stream,
    hidden: ww.hidden,
    postedWeek: week,
    expiresWeek: week + rng.int(3, 6),
    ...(variant ? { variant: { id: variant.id, label: variant.label, brief: variant.brief } } : {}),
    ...(requirements ? { requirements } : {}),
    ...(tier !== 'basic' ? { tier } : {}),
  };
}

/**
 * The design used to price an enquiry (tier, variant or base reference), laid out for the Studio canvas. Developer mode
 * loads it into the active project so the generated jobs can be checked against their own reference.
 */
export function enquiryReferenceGraph(e: Enquiry, tech: readonly TechId[]): ProcessGraph {
  let g: ProcessGraph;
  if (e.tier && e.tier !== 'basic') g = tierDesign(e.tier, e.industry, e.trueStream, tech, e.seed).graph;
  else {
    const v = e.variant ? VARIANTS.find((x) => x.id === e.variant!.id) : undefined;
    const d = v ? v.reference(e.trueStream) : REFERENCE[e.industry](e.trueStream);
    g = Array.isArray(d) ? linearGraph(d) : d;
  }
  // main train in a row, side units (reclaim, sludge line, brine treatment) on a second row
  const main = g.nodes.filter((n) => n.kind === 'influent' || /^u\d+$/.test(n.id));
  const side = g.nodes.filter((n) => !main.includes(n) && n.kind !== 'discharge');
  main.forEach((n, i) => (n.position = { x: i * 190, y: 160 }));
  side.forEach((n, i) => (n.position = { x: 380 + i * 190, y: 420 }));
  const out = g.nodes.find((n) => n.kind === 'discharge');
  if (out) out.position = { x: main.length * 190, y: 160 };
  return g;
}
