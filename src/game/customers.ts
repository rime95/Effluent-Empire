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
import { ClientVariant, VARIANT_CHANCE, VARIANT_PREMIUM, eligibleVariants } from './variants';

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
}

export interface EnquiryOptions {
  /** researched technologies; undefined = legacy generation (no tough jobs) */
  tech?: readonly TechId[];
  /** company names already in play (open enquiries, projects, plants): not reused */
  usedNames?: ReadonlySet<string>;
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
  const industry = rng.pick(pool);
  const t = INDUSTRIES[industry];
  // project size grows with reputation: a new consultancy only gets the smaller jobs
  const sizeFrac = Math.min(1, 0.35 + Math.max(0, reputation) / 100);
  const template = { ...t, Q: [t.Q[0], t.Q[0] + (t.Q[1] - t.Q[0]) * sizeFrac] as [number, number] };
  const ww = generateWastewater(template, rng);
  let standard: StandardId = rng.chance(0.2 + Math.min(0.3, Math.max(0, reputation) / 400)) ? 'A' : 'B';
  const difficult = rng.chance(0.2);

  // tough job: an independent RNG stream, so the base enquiry for this seed is unchanged
  let variant: ClientVariant | undefined;
  if (opts.tech) {
    const vr = createRng(seed * 7919 + 17);
    const open = eligibleVariants(industry, opts.tech);
    if (open.length && vr.chance(VARIANT_CHANCE)) {
      variant = vr.pick(open);
      ww.stream = variant.overlay(ww.stream, vr);
      if (variant.standardA) standard = 'A';
    }
  }
  const refTrain = variant ? variant.reference(ww.stream) : REFERENCE[industry](ww.stream);
  const ref = simulate(linearGraph(refTrain), ww.stream);
  const markup = rng.range(1.35, 1.6);
  const repFactor = 1 + Math.min(0.15, Math.max(-0.15, reputation / 600));
  const contractValue = Math.round((ref.capex * markup * (standard === 'A' ? 1.25 : 1) * repFactor * (difficult ? 0.88 : 1) * (variant ? VARIANT_PREMIUM : 1)) / 1000) * 1000;

  return {
    id: `E${seed}`,
    seed,
    company: pickName(t.names, rng, opts.usedNames),
    industry,
    standard,
    contractValue,
    // customer's OPEX expectation: generous vs the reference design so sludge, instruments and safety margins fit (GAME MODEL)
    opexLimitRMd: Math.round(ref.opexRMd * rng.range(1.8, 2.5) + 80),
    deadlineWeeks: difficult ? rng.int(9, 12) : rng.int(13, 18),
    difficult,
    declared: declaredDatasheet(ww.stream, rng, ww.hidden.undeclaredZn, ww.hidden.undeclaredCrVI),
    trueStream: ww.stream,
    hidden: ww.hidden,
    postedWeek: week,
    expiresWeek: week + rng.int(3, 6),
    ...(variant ? { variant: { id: variant.id, label: variant.label, brief: variant.brief } } : {}),
  };
}
