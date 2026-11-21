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
import { createRng } from './rng';

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
}

/** Milestone payment schedule (typical design-and-build terms). */
export const PAYMENT = { advance: 0.3, mechanicalCompletion: 0.6, retention: 0.1 };

export function generateEnquiry(seed: number, week: number, reputation: number): Enquiry {
  const rng = createRng(seed);
  // early game: no semiconductor until some reputation is earned
  const pool: IndustryId[] = reputation >= 40 ? ['plating', 'food', 'semiconductor'] : ['plating', 'food'];
  const industry = rng.pick(pool);
  const t = INDUSTRIES[industry];
  // project size grows with reputation: a new consultancy only gets the smaller jobs
  const sizeFrac = Math.min(1, 0.35 + Math.max(0, reputation) / 100);
  const template = { ...t, Q: [t.Q[0], t.Q[0] + (t.Q[1] - t.Q[0]) * sizeFrac] as [number, number] };
  const ww = generateWastewater(template, rng);
  const standard: StandardId = rng.chance(0.2 + Math.min(0.3, Math.max(0, reputation) / 400)) ? 'A' : 'B';
  const difficult = rng.chance(0.2);

  const ref = simulate(linearGraph(REFERENCE[industry](ww.stream)), ww.stream);
  const markup = rng.range(1.35, 1.6);
  const repFactor = 1 + Math.min(0.15, Math.max(-0.15, reputation / 600));
  const contractValue = Math.round((ref.capex * markup * (standard === 'A' ? 1.25 : 1) * repFactor * (difficult ? 0.88 : 1)) / 1000) * 1000;

  return {
    id: `E${seed}`,
    seed,
    company: rng.pick(t.names),
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
  };
}
