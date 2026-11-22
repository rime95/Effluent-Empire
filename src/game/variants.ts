/**
 * Tougher client types opened by the Technology Tree. A variant reshapes the base industry wastewater (physically
 * plausible overlay ranges documented in knowledge/processes/technology_tree.md) and replaces the reference design
 * used for pricing with one that uses the advanced technology. Variants draw from their own RNG stream, so the base
 * enquiry for a seed is unchanged whether or not a variant is applied.
 */
import { Stream } from '../simulation/core/stream';
import { IndustryId } from './industries';
import { TrainSpec } from './referenceDesigns';
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
  reference: (s: Stream) => TrainSpec;
  /** force Standard A (tight limits are often the reason the technology is needed) */
  standardA?: boolean;
}

/** Chance that an enquiry is a tough job when at least one variant is open. */
export const VARIANT_CHANCE = 0.4;
/** Price premium on tough jobs over reference-design pricing (GAME MODEL). */
export const VARIANT_PREMIUM = 1.15;

/** Registered as each technology's engineering model lands. */
export const VARIANTS: ClientVariant[] = [];

export function eligibleVariants(industry: IndustryId, tech: readonly TechId[]): ClientVariant[] {
  return VARIANTS.filter((v) => v.industry === industry && v.requires.every((r) => tech.includes(r)));
}
