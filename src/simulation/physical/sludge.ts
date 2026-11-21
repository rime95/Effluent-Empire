/**
 * Sludge line: draw-off stream construction, gravity thickener, filter press.
 * Ref: knowledge/physical/sludge_thickening_dewatering.md — all coefficients are GAME MODEL (verify), see the doc.
 */
import { METALS, POOLS, Stream, cloneStream, emptyStream, poolMass, splitPools, tss } from '../core/stream';
import { Note, ProcessResult, result } from '../treatment/types';

/** Dry-solids mass flow of a removed stream (concentrations relative to its Q), kg/d. */
export function removedDryKgD(removed: Stream): number {
  return (removed.Q * (POOLS.reduce((a, p) => a + poolMass(removed, p), 0) + removed.OGfree + removed.OGemulsified)) / 1000;
}

/** Particulate fields copied/scaled when sludge water is split from a unit outlet. */
const PART_SCALARS = ['grit', 'inert', 'colloid', 'floc', 'XS', 'XI', 'biomass', 'alSolid', 'feSolid', 'OGfree', 'OGemulsified'] as const;

/**
 * Split a unit's outlet into the main stream and a real sludge stream of flow Qs carrying the removed solids.
 * Water (with the outlet's dissolved composition) moves from main to sludge; particulates left in main are concentrated
 * so their mass is unchanged. `removed` concentrations are relative to `inletQ`.
 */
export function splitSludge(out: Stream, removed: Stream, inletQ: number, Qs: number): { main: Stream; sludge: Stream } {
  // floor: a sludge stream always carries its solids (mass is conserved even for a vanishing draw-off)
  const q = Math.min(Math.max(Qs, 1e-6 * out.Q), 0.95 * out.Q);
  const main = cloneStream(out);
  main.Q = out.Q - q;
  const k = main.Q > 0 ? out.Q / main.Q : 1;
  for (const f of PART_SCALARS) (main[f] as number) = (out[f] as number) * k;
  for (const m of METALS) main.precipitated[m] = out.precipitated[m] * k;

  const sludge = cloneStream(out); // dissolved species at the outlet concentration
  sludge.Q = q;
  sludge.peakFactor = 1;
  sludge.ml = undefined;
  const r = q > 0 ? inletQ / q : 0;
  for (const f of PART_SCALARS) (sludge[f] as number) = (removed[f] as number) * r;
  for (const m of METALS) sludge.precipitated[m] = removed.precipitated[m] * r;
  // settling data travels with the solids (out.v50 = the unit's inlet settling characteristics)
  return { main, sludge };
}

/** Default underflow solids mass fraction by unit kind (GAME MODEL). null → use a volume rule (filter backwash). */
export function defaultSludgeFraction(kind: string, inlet: Stream): number | null {
  if (kind === 'clarifier') return inlet.ml || inlet.biomass > 0.5 * Math.max(tss(inlet), 1e-9) ? 0.008 : 0.01;
  if (kind === 'oilSep') return 0.05;
  if (kind === 'sandFilter') return null;
  return 0.01;
}
/** Backwash water as a fraction of filter throughput. */
export const BACKWASH_FRACTION = 0.03;

export type SludgeType = 'chemical' | 'biological';
export function sludgeType(s: Stream): SludgeType {
  return s.biomass > 0.5 * Math.max(tss(s), 1e-9) ? 'biological' : 'chemical';
}

export const THICKENER = {
  // verify: WAS gravity thickening is poor in practice; 30 kg/m²·d is the top of the M&E range
  chemical: { slr: 20, solids: 0.03, hlrMax: 24 },
  biological: { slr: 30, solids: 0.025, hlrMax: 8 },
  capture: 0.95,
};

/** Uniform capture of all particulates (and oil) into the removed stream. */
function captureAll(s: Stream, capture: number) {
  const removal = Object.fromEntries(POOLS.map((p) => [p, capture])) as Record<(typeof POOLS)[number], number>;
  const { out, removed } = splitPools(s, removal);
  removed.OGfree = s.OGfree * capture;
  removed.OGemulsified = s.OGemulsified * capture;
  out.OGfree = s.OGfree * (1 - capture);
  out.OGemulsified = s.OGemulsified * (1 - capture);
  return { out, removed };
}

export function thicken(s: Stream, p: { area_m2: number }): ProcessResult {
  const notes: Note[] = [];
  const dry = (s.Q * tss(s)) / 1000;
  const type = sludgeType(s);
  const d = THICKENER[type];
  const slr = dry / Math.max(p.area_m2, 1e-6);
  const r = slr / d.slr;
  const feedFrac = tss(s) / 1e6;
  let w = d.solids * Math.pow(Math.min(1, 1 / Math.max(r, 1e-9)), 0.4);
  // hydraulic loading check (verify: chemical ≈ 15–30, WAS ≈ 4–8 m³/m²·d): too much water carries solids over the weir
  const hlr = s.Q / Math.max(p.area_m2, 1e-6);
  const h = hlr / d.hlrMax;
  let capture = r <= 1 ? THICKENER.capture : THICKENER.capture / (1 + 0.6 * (r - 1) ** 2);
  if (h > 1) {
    capture /= 1 + 0.5 * (h - 1) ** 2;
    notes.push({ level: 'warn', code: 'thick.hlr', text: `Hydraulic loading ${hlr.toFixed(1)} m³/m²·d exceeds ≈${d.hlrMax} for ${type} sludge: solids wash over the weir.` });
  }
  // a thickener cannot make sludge thinner than its feed
  if (w <= feedFrac * 1.1) {
    w = feedFrac * 1.1;
    notes.push({ level: 'warn', code: 'thick.noThickening', text: `Feed is already ${(feedFrac * 100).toFixed(1)} % solids — the thickener adds almost nothing at this loading.` });
  }
  const { out, removed } = captureAll(s, capture);
  if (r > 1.2) notes.push({ level: 'warn', code: 'thick.overload', text: `Solids loading ${slr.toFixed(0)} kg/m²·d is ${r.toFixed(1)}× the ${type} design value (${d.slr}): thin underflow (${(w * 100).toFixed(1)} %) and solids in the supernatant.` });
  if (s.Q > 0 && tss(s) < 2000) notes.push({ level: 'info', code: 'thick.dilute', text: `Feed is dilute (${(tss(s) / 10000).toFixed(2)} % solids) — a thickener is the right first step before dewatering.` });
  return result(out, {
    removed,
    sludgeSolidsFrac: w,
    notes,
    energy_kWhd: 24 * (0.15 + 0.01 * p.area_m2), // rake drive scales with tank size (GAME MODEL)
    calcs: {
      slr: { label: 'Solids loading rate', value: slr, unit: 'kg/m²·d', digits: 1 },
      hlr: { label: 'Hydraulic loading rate', value: hlr, unit: 'm³/m²·d', digits: 1 },
      type: { label: `Sludge type: ${type} — design SLR`, value: d.slr, unit: 'kg/m²·d', digits: 0 },
      under: { label: 'Underflow solids', value: w * 100, unit: '%', digits: 1 },
      capture: { label: 'Solids capture', value: capture * 100, unit: '%', digits: 1 },
      dry: { label: 'Dry solids fed', value: dry, unit: 'kg/d', digits: 1 },
    },
  });
}

export const PRESS = {
  cake: { chemical: { polymer: 0.25, lime: 0.35 }, biological: { polymer: 0.2, lime: 0.28 } },
  capture: 0.97,
  overloadCapture: 0.9,
  polymer_kgPerT: 3,
  lime_fracDS: 0.2,
  cakeDensity: 1200,
  kWhPerM3: 0.5,
  polymerPriceRMkg: 14,
  limePriceRMkg: 0.8,
};

export function filterPress(s: Stream, p: { chamber_m3: number; cycles: number; conditioning: 'polymer' | 'lime' }): ProcessResult {
  const notes: Note[] = [];
  const type = sludgeType(s);
  const dryIn = (s.Q * tss(s)) / 1000;
  const lime = p.conditioning === 'lime' ? PRESS.lime_fracDS * dryIn : 0; // kg/d, ends in the cake
  let w = PRESS.cake[type][p.conditioning];
  let capture = PRESS.capture;
  const cakeMass = (dryIn * capture + lime) / w; // wet kg/d
  const cakeVol = cakeMass / PRESS.cakeDensity; // m³/d
  // dilute feed lengthens filling (more filtrate per cake): effective cycles ∝ √(feed solids / 3 %), GAME MODEL
  const feedFrac = tss(s) / 1e6;
  const effCycles = Math.max(p.cycles, 0.1) * Math.min(1, Math.sqrt(feedFrac / 0.03));
  const capacity = Math.max(p.chamber_m3, 1e-6) * effCycles;
  const load = cakeVol / capacity;
  if (load > 1) {
    w = w / Math.min(2, load);
    capture = PRESS.overloadCapture;
    notes.push({ level: 'warn', code: 'press.overload', text: `Press is ${(load * 100).toFixed(0)} % of its chamber capacity (${capacity.toFixed(2)} m³/d): short cycles, wet cake (${(w * 100).toFixed(0)} % DS) and solids in the filtrate. Add chamber volume or cycles.` });
  }
  const { out, removed } = captureAll(s, capture);
  if (lime > 0 && s.Q > 0) removed.inert += (lime * 1000) / s.Q; // lime solids join the cake (concentration relative to feed Q)
  if (tss(s) > 0 && tss(s) < 10000) notes.push({ level: 'info', code: 'press.dilute', text: `Feed is only ${(tss(s) / 10000).toFixed(2)} % solids — thicken first to cut press size and cycle count.` });
  const chemicals = p.conditioning === 'polymer' ? [{ name: 'Sludge polymer (cationic PAM)', kgPerDay: (PRESS.polymer_kgPerT * dryIn) / 1000, priceRMkg: PRESS.polymerPriceRMkg }] : [{ name: 'Hydrated lime for sludge conditioning', kgPerDay: lime, priceRMkg: PRESS.limePriceRMkg }];
  return result(out, {
    removed,
    sludgeSolidsFrac: w,
    notes,
    chemicals,
    produced: lime > 0 ? { mineral: lime } : {},
    energy_kWhd: PRESS.kWhPerM3 * s.Q,
    calcs: {
      dry: { label: 'Dry solids fed', value: dryIn, unit: 'kg/d', digits: 1 },
      cake: { label: `Cake solids (${type}, ${p.conditioning})`, value: w * 100, unit: '% DS', digits: 0 },
      cakeMass: { label: 'Cake produced', value: (dryIn * capture + lime) / w, unit: 'kg/d wet', digits: 0 },
      capture: { label: 'Solids capture', value: capture * 100, unit: '%', digits: 0 },
      load: { label: 'Chamber utilisation', value: load * 100, unit: '%', digits: 0 },
      eff: { label: 'Effective cycles (feed-solids limited)', value: effCycles, unit: '/d', digits: 1 },
    },
  });
}

export function passThrough(s: Stream): ProcessResult {
  return result(cloneStream(s));
}

export { emptyStream };
