/**
 * Tougher client types opened by the Technology Tree. A variant reshapes the base industry wastewater (physically
 * plausible overlay ranges documented in knowledge/processes/technology_tree.md) and replaces the reference design
 * used for pricing with one that uses the advanced technology. Variants draw from their own RNG stream, so the base
 * enquiry for a seed is unchanged whether or not a variant is applied.
 */
import { Stream } from '../simulation/core/stream';
import { IndustryId } from './industries';
import { TrainSpec, dafFoodTrain, metalTrain, sludgeLineGraph, sulfideMetalTrain } from './referenceDesigns';
import { ProcessGraph, SimResult, linearGraph } from '../simulation/treatment/graph';
import { Requirements } from './requirements';
import { defaultParams } from '../simulation/treatment/catalogue';
import { Rng } from './rng';
import { TechId } from './tech';

export interface ClientVariant {
  id: string;
  industry: IndustryId;
  requires: TechId[];
  /** shown on the enquiry card: "Tough job: …" */
  label: string;
  /** why the job needs the technology (enquiry detail) */
  brief: string;
  /** reshape the true wastewater */
  overlay: (s: Stream, rng: Rng) => Stream;
  /** reference design (with the advanced technology) used to price the job */
  reference: (s: Stream) => TrainSpec | ProcessGraph;
  /** contract requirements derived from the reference design's simulation (e.g. a disposal-cost cap) */
  requirements?: (ref: SimResult) => Requirements;
  /** force a discharge standard (tight limits are often the reason the technology is needed) */
  standard?: 'A' | 'B';
}

/** Chance that an enquiry is a tough job when at least one variant is open. */
export const VARIANT_CHANCE = 0.4;
/** Price premium on tough jobs over reference-design pricing (GAME MODEL). */
export const VARIANT_PREMIUM = 1.15;

/** Registered as each technology's engineering model lands. */
export const VARIANTS: ClientVariant[] = [
  {
    id: 'emulsifiedOil',
    industry: 'food',
    requires: ['daf'],
    label: 'Edible-oil refinery — emulsified oil',
    brief: 'Refinery and frying-line wastewater: most of the oil is emulsified (soapstock, detergents). A gravity separator barely touches it — break the emulsion and float it.',
    overlay: (s, rng) => {
      const og = rng.range(200, 500);
      const free = rng.range(0.2, 0.4);
      s.OGfree = og * free;
      s.OGemulsified = og * (1 - free);
      return s;
    },
    reference: (s) => dafFoodTrain(s),
    standard: 'B',
  },
  {
    id: 'sludgeCap',
    industry: 'plating',
    requires: ['dryer'],
    label: 'Heavy-metal finisher — disposal-cost cap',
    brief: 'High-load nickel/copper lines make a lot of hydroxide sludge, and the client caps what it will pay for scheduled-waste haulage. Wet cake will not fit under the cap.',
    overlay: (s, rng) => {
      s.dissolved = { ...s.dissolved, Ni: rng.range(25, 60), Cu: rng.range(10, 35), Zn: rng.range(5, 20) };
      return s;
    },
    reference: (s) => {
      const train = metalTrain(s.Q, s.CrVI > 0.05);
      const clar = train.findIndex((u) => u.kind === 'clarifier');
      const q = (k: 'thickener' | 'filterPress' | 'dryer', over: Record<string, number | string>) => ({ kind: k, params: { ...defaultParams(k, s.Q), ...over } });
      // sludge line sized on the dry-solids load: thickener at ~15 kg/m²·d, press for 3 cycles/d of ~25 % DS cake, dryer to 80 % DS
      const dryKgD = (s.Q * (2.5 * (s.dissolved.Ni + s.dissolved.Cu + s.dissolved.Zn) + 150)) / 1000;
      return sludgeLineGraph(train, clar, [
        q('thickener', { area: Math.max(2, Math.ceil(dryKgD / 15)) }),
        q('filterPress', { volume: Math.max(0.2, Math.ceil((dryKgD / 0.25 / 1000 / 3) * 1.6 * 20) / 20), cycles: 3, conditioning: 'polymer' }),
        q('dryer', { targetDS: 80 }),
      ]);
    },
    requirements: (ref) => ({ sludgeCapRMd: Math.round(ref.opexSplit.sludge * 1.3) }),
    standard: 'B',
  },
  {
    id: 'complexedNi',
    industry: 'plating',
    requires: ['sulfide'],
    label: 'Electroless-nickel plater — complexed nickel',
    brief: 'Electroless-nickel and alkaline copper baths carry citrate, lactate and ammonia: much of the nickel is complexed and stays dissolved however high you raise the pH. The metals panel shows the complexed share.',
    overlay: (s, rng) => {
      const ni = rng.range(15, 40);
      const f = rng.range(0.45, 0.75);
      s.dissolved = { ...s.dissolved, Ni: ni * (1 - f) };
      s.complexed = { ...(s.complexed ?? { Ni: 0, Cu: 0, Zn: 0, Cr: 0 }), Ni: ni * f };
      return s;
    },
    reference: (s) => sulfideMetalTrain(s),
    standard: 'B',
  },
];

export function eligibleVariants(industry: IndustryId, tech: readonly TechId[]): ClientVariant[] {
  return VARIANTS.filter((v) => v.industry === industry && v.requires.every((r) => tech.includes(r)));
}

/** The variant's reference design as a process graph. */
export function referenceGraph(v: ClientVariant, s: Stream): ProcessGraph {
  const d = v.reference(s);
  return Array.isArray(d) ? linearGraph(d) : d;
}
