/**
 * Dissolved-air flotation. Ref: knowledge/physical/flotation.md (Metcalf & Eddy air-to-solids ratio).
 * GAME MODEL capture: η = φ·(1 − exp(−(A/S)/0.008))·h(HLR); floatability φ per material; emulsified oil must be
 * broken by coagulation upstream (it reaches the DAF as free oil).
 */
import { POOLS, Pool, Stream, poolMass, splitPools, tss } from '../core/stream';
import { Note, ProcessResult, result } from '../treatment/types';

/** air solubility in water at 1 atm, mL/L (M&E; verify) */
const AIR_SOL: [number, number][] = [
  [0, 29.2],
  [10, 22.8],
  [20, 18.7],
  [30, 15.7],
  [40, 14.2],
];
export function airSolubility_mLL(T: number): number {
  const t = Math.min(40, Math.max(0, T));
  for (let i = 1; i < AIR_SOL.length; i++) {
    const [t0, s0] = AIR_SOL[i - 1];
    const [t1, s1] = AIR_SOL[i];
    if (t <= t1) return s0 + ((s1 - s0) * (t - t0)) / (t1 - t0);
  }
  return AIR_SOL[AIR_SOL.length - 1][1];
}

export const DAF = {
  /** saturator efficiency (packed saturator), verify */
  f: 0.8,
  /** A/S scale of the bubble-attachment term, mL/mg (GAME MODEL) */
  asScale: 0.008,
  /** hydraulic loading above which bubbles are swept out, m/h */
  hlrOK: 10,
  hlrDecay: 8,
  floatSolids: 0.04,
  pumpEff: 0.65,
};

/** floatability (fraction that can attach to bubbles) per solids pool; grit settles in the hopper instead (verify) */
const PHI: Record<Pool, number> = { grit: 0.8, inert: 0.7, colloid: 0.05, floc: 0.95, organic: 0.95, precipitate: 0.95, alFloc: 0.95, feFloc: 0.95, biomass: 0.95 };
const PHI_FREE_OIL = 0.98;
const PHI_EMULSION = 0.1;

/** A/S = 1.3·s_a·(f·P − 1)·R / (S_a·Q), mL air per mg solids. */
export function airToSolids(p: { T: number; pressure_kPa: number; recycle_m3d: number; feed_m3d: number; solids_mgL: number }): number {
  const P = (p.pressure_kPa + 101.3) / 101.3;
  const air = 1.3 * airSolubility_mLL(p.T) * Math.max(0, DAF.f * P - 1) * p.recycle_m3d; // mg air/d ÷ 1000 L/m³ cancels with mg/L·m³
  return air / Math.max(p.solids_mgL * p.feed_m3d, 1e-9);
}

export function flotate(s: Stream, p: { area_m2: number; recycle_pct: number; pressure_kPa: number }): ProcessResult {
  const Qpk = s.Q * s.peakFactor;
  const R = (s.Q * Math.max(0, p.recycle_pct)) / 100; // recycle sized on average flow (pump runs constantly)
  const oil = s.OGfree + s.OGemulsified;
  const Sa = tss(s) + oil;
  const AS = airToSolids({ T: s.T, pressure_kPa: p.pressure_kPa, recycle_m3d: R, feed_m3d: Qpk, solids_mgL: Sa });
  const hlr = (Qpk + R) / 24 / Math.max(p.area_m2, 1e-6);
  const slr = (Qpk * Sa) / 1000 / 24 / Math.max(p.area_m2, 1e-6);
  const bubble = 1 - Math.exp(-AS / DAF.asScale);
  const h = hlr <= DAF.hlrOK ? 1 : Math.exp(-(hlr - DAF.hlrOK) / DAF.hlrDecay);
  const removal: Partial<Record<Pool, number>> = {};
  for (const pool of POOLS) removal[pool] = pool === 'grit' ? PHI.grit : PHI[pool] * bubble * h;
  const { out, removed } = splitPools(s, removal);
  const rFree = PHI_FREE_OIL * bubble * h;
  const rEm = PHI_EMULSION * bubble * h;
  removed.OGfree = s.OGfree * rFree;
  removed.OGemulsified = s.OGemulsified * rEm;
  out.OGfree = s.OGfree * (1 - rFree);
  out.OGemulsified = s.OGemulsified * (1 - rEm);

  const notes: Note[] = [];
  if (AS < 0.005) notes.push({ level: 'warn', code: 'daf.lowAS', text: `Air-to-solids ratio ${AS.toFixed(4)} mL/mg is below 0.005 — too few bubbles for this solids and oil load. Raise the recycle or saturator pressure.` });
  if (AS > 0.1) notes.push({ level: 'info', code: 'daf.highAS', text: `A/S ${AS.toFixed(3)} mL/mg is far above the 0.02–0.06 design range — recycle pumping energy is wasted.` });
  if (hlr > 12) notes.push({ level: 'warn', code: 'daf.hlr', text: `Hydraulic loading ${hlr.toFixed(1)} m/h (feed + recycle) exceeds ~12 m/h — bubbles and floc are swept to the outlet.` });
  if (slr > 10) notes.push({ level: 'warn', code: 'daf.slr', text: `Solids loading ${slr.toFixed(1)} kg/m²·h exceeds ~10 kg/m²·h — enlarge the DAF.` });
  if (s.OGemulsified > 0.3 * Math.max(oil, 1e-9) && s.OGemulsified > 5)
    notes.push({ level: 'warn', code: 'daf.emulsion', text: `${s.OGemulsified.toFixed(0)} mg/L of the oil is still emulsified — micro-droplets do not attach to bubbles. Break the emulsion with coagulation (coagulant + pH) upstream of the DAF.` });

  const kWhd = (R * p.pressure_kPa) / 3600 / DAF.pumpEff + 0.25 * 24;
  const floatKg = (s.Q * (POOLS.reduce((a, pl) => a + poolMass(removed, pl), 0) + removed.OGfree + removed.OGemulsified)) / 1000;
  return result(out, {
    removed,
    notes,
    energy_kWhd: kWhd,
    sludgeSolidsFrac: DAF.floatSolids,
    calcs: {
      as: { label: 'Air-to-solids ratio A/S', value: AS, unit: 'mL/mg', digits: 4 },
      hlr: { label: 'Hydraulic loading (peak feed + recycle)', value: hlr, unit: 'm/h', digits: 1 },
      slr: { label: 'Solids loading (peak)', value: slr, unit: 'kg/m²·h', digits: 1 },
      rec: { label: 'Recycle flow', value: R, unit: 'm³/d', digits: 0 },
      sa: { label: 'Air solubility (1 atm, T)', value: airSolubility_mLL(s.T), unit: 'mL/L', digits: 1 },
      rOil: { label: 'Free-oil capture', value: 100 * rFree, unit: '%', digits: 0 },
      rEm: { label: 'Emulsified-oil capture', value: 100 * rEm, unit: '%', digits: 0 },
      rTSS: { label: 'Floc capture', value: 100 * PHI.floc * bubble * h, unit: '%', digits: 0 },
      float: { label: 'Float produced (dry, incl. oil)', value: floatKg, unit: 'kg/d', digits: 1 },
    },
  });
}
