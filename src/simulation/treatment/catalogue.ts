/**
 * Treatment unit catalogue: design inputs, process model binding, CAPEX and footprint.
 * Ref: knowledge/processes/*.md (technology profiles)
 *
 * CAPEX — GAME MODEL six-tenths rule: C = C_ref · (size / size_ref)^0.6  (RM, 2026 Malaysian price level, indicative).
 */
import { Stream } from '../core/stream';
import { activatedSludge } from '../biological/activatedSludge';
import { Coagulant, COAGULANTS, coagulate } from '../chemistry/coagulation';
import { neutralise } from '../chemistry/neutralisation';
import { reduceChromium } from '../chemistry/chromiumReduction';
import { adsorb } from '../physical/carbon';
import { clarify, equalise, filter, separateOil } from '../physical/units';
import { ProcessResult } from './types';
import { filterPress, passThrough, thicken } from '../physical/sludge';

export type UnitType = 'eq' | 'oilSep' | 'crReduction' | 'neutralisation' | 'precipitation' | 'coagulation' | 'clarifier' | 'activatedSludge' | 'sandFilter' | 'carbon' | 'thickener' | 'filterPress' | 'splitter' | 'mixer';
export type Category = 'physical' | 'chemical' | 'biological' | 'sludge' | 'hydraulic';
export type ParamValue = number | string;
export type Params = Record<string, ParamValue>;

export interface ParamDef {
  key: string;
  label: string;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** default value as a function of average design flow Q (m³/d) */
  default: (Q: number) => ParamValue;
  help?: string;
}

export interface UnitContext {
  clarifierFollows: boolean;
}

export interface UnitDef {
  type: UnitType;
  name: string;
  tagPrefix: string;
  category: Category;
  summary: string;
  params: ParamDef[];
  run: (s: Stream, p: Params, ctx: UnitContext) => ProcessResult;
  capex: (p: Params, s: Stream, r: ProcessResult) => number;
  footprint: (p: Params) => number;
}

const scale = (ref: number, size: number, sizeRef: number) => ref * Math.pow(Math.max(size, 1e-6) / sizeRef, 0.6);
const n = (p: Params, k: string) => Number(p[k]);
const round = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);

export const CATALOGUE: Record<UnitType, UnitDef> = {
  eq: {
    type: 'eq',
    name: 'Equalisation Tank',
    tagPrefix: 'TK',
    category: 'physical',
    summary: 'Buffers flow and load variations so downstream units are sized for a lower peak.',
    params: [{ key: 'volume', label: 'Working volume', unit: 'm³', min: 5, max: 20000, step: 5, default: (Q) => round(Q * 0.33, 5), help: '8 h of average flow is a common starting point.' }],
    run: (s, p) => equalise(s, { volume_m3: n(p, 'volume') }),
    capex: (p) => scale(180_000, n(p, 'volume'), 200),
    footprint: (p) => n(p, 'volume') / 4,
  },
  oilSep: {
    type: 'oilSep',
    name: 'Oil Separator',
    tagPrefix: 'OS',
    category: 'physical',
    summary: 'Gravity separator: free oil droplets rise (Stokes’ law) and are skimmed; grit settles.',
    params: [{ key: 'area', label: 'Surface area', unit: 'm²', min: 1, max: 2000, step: 1, default: (Q) => round(Q / 24 / 1.5, 1), help: 'Design surface loading ≤ 2 m/h for 100 µm droplets.' }],
    run: (s, p) => separateOil(s, { area_m2: n(p, 'area') }),
    capex: (p) => scale(80_000, n(p, 'area'), 10),
    footprint: (p) => n(p, 'area') * 1.3,
  },
  crReduction: {
    type: 'crReduction',
    name: 'Chromium Reduction',
    tagPrefix: 'CR',
    category: 'chemical',
    summary: 'Reduces hexavalent chromium (an anion that never precipitates) to Cr(III) with metabisulfite at pH 2–2.5.',
    params: [
      { key: 'targetPH', label: 'Reduction pH', unit: '', min: 1.5, max: 6, step: 0.1, default: () => 2.5 },
      { key: 'doseFactor', label: 'Metabisulfite dose (× stoichiometric)', unit: '×', min: 0, max: 4, step: 0.1, default: () => 1.3, help: 'Stoichiometric demand is 2.74 mg Na₂S₂O₅ per mg Cr(VI); dissolved oxygen consumes extra.' },
      { key: 'volume', label: 'Reactor volume', unit: 'm³', min: 1, max: 2000, step: 1, default: (Q) => round(Q / 24 / 2, 1), help: '15–20 min retention at PEAK flow — place it after equalisation.' },
    ],
    run: (s, p) => reduceChromium(s, { targetPH: n(p, 'targetPH'), doseFactor: n(p, 'doseFactor'), volume_m3: n(p, 'volume') }),
    capex: (p) => scale(60_000, n(p, 'volume'), 10) + 55_000,
    footprint: (p) => n(p, 'volume') / 3 + 12,
  },
  neutralisation: {
    type: 'neutralisation',
    name: 'pH Adjustment',
    tagPrefix: 'NT',
    category: 'chemical',
    summary: 'Doses caustic, lime or acid to a pH set-point. Dose follows the titration (buffer capacity), not a fixed rate.',
    params: [
      { key: 'targetPH', label: 'pH set-point', unit: '', min: 2, max: 12, step: 0.1, default: () => 7.0 },
      { key: 'base', label: 'Alkali', unit: '', options: [{ value: 'NaOH', label: 'Caustic soda (NaOH)' }, { value: 'lime', label: 'Hydrated lime' }], default: () => 'NaOH' },
      { key: 'volume', label: 'Tank volume', unit: 'm³', min: 1, max: 2000, step: 1, default: (Q) => round(Q / 24 / 3, 1), help: '≥ 15 min retention at peak flow for stable control.' },
    ],
    run: (s, p) => neutralise(s, { targetPH: n(p, 'targetPH'), base: p.base as 'NaOH' | 'lime', volume_m3: n(p, 'volume') }),
    capex: (p) => scale(50_000, n(p, 'volume'), 10) + 35_000,
    footprint: (p) => n(p, 'volume') / 3 + 10,
  },
  precipitation: {
    type: 'precipitation',
    name: 'Hydroxide Precipitation',
    tagPrefix: 'PR',
    category: 'chemical',
    summary: 'Raises pH so dissolved metals exceed their hydroxide solubility and precipitate. Each metal has its own optimum pH.',
    params: [
      { key: 'targetPH', label: 'Reaction pH', unit: '', min: 6, max: 12.5, step: 0.1, default: () => 9.5 },
      { key: 'base', label: 'Alkali', unit: '', options: [{ value: 'NaOH', label: 'Caustic soda (NaOH)' }, { value: 'lime', label: 'Hydrated lime' }], default: () => 'NaOH' },
      { key: 'volume', label: 'Reactor volume', unit: 'm³', min: 1, max: 5000, step: 1, default: (Q) => round(Q / 24 / 2, 1), help: '30 min retention grows larger, faster-settling precipitate.' },
    ],
    run: (s, p) => neutralise(s, { targetPH: n(p, 'targetPH'), base: p.base as 'NaOH' | 'lime', volume_m3: n(p, 'volume') }),
    capex: (p) => scale(70_000, n(p, 'volume'), 30) + 40_000,
    footprint: (p) => n(p, 'volume') / 3.5 + 10,
  },
  coagulation: {
    type: 'coagulation',
    name: 'Coagulation / Flocculation',
    tagPrefix: 'CF',
    category: 'chemical',
    summary: 'Destabilises colloids and fine precipitates so they form settleable floc. Dose must be optimised (jar test).',
    params: [
      { key: 'coagulant', label: 'Coagulant', unit: '', options: (Object.keys(COAGULANTS) as Coagulant[]).map((c) => ({ value: c, label: COAGULANTS[c].label })), default: () => 'pac' },
      { key: 'dose', label: 'Dose', unit: 'mg/L', min: 0, max: 2000, step: 5, default: () => 80 },
      { key: 'flocTime', label: 'Flocculation time', unit: 'min', min: 1, max: 60, step: 1, default: () => 20 },
      { key: 'pHset', label: 'pH control set-point (0 = off)', unit: '', min: 0, max: 11, step: 0.1, default: () => 0, help: 'Trims pH with NaOH/H₂SO₄ after coagulant dosing — keeps metals precipitated and the coagulant in its window.' },
      { key: 'polymer', label: 'Polymer flocculant (anionic PAM)', unit: 'mg/L', min: 0, max: 10, step: 0.1, default: () => 1.0, help: 'Bridges floc and hydroxide precipitate into large, fast-settling flocs. Optimum ≈ 0.5–2 mg/L; overdosing hurts.' },
    ],
    run: (s, p) => coagulate(s, { coagulant: p.coagulant as Coagulant, dose_mgL: n(p, 'dose'), flocTime_min: n(p, 'flocTime'), pHset: n(p, 'pHset'), polymer_mgL: Number(p.polymer ?? 0) || 0 }),
    capex: (p, s) => scale(90_000, s.Q * s.peakFactor, 250) * (0.7 + 0.3 * (n(p, 'flocTime') / 20)) + 30_000, // pH-trim instruments are costed in instrumentation.ts
    footprint: (p) => 15 + n(p, 'flocTime') * 0.8,
  },
  clarifier: {
    type: 'clarifier',
    name: 'Clarifier',
    tagPrefix: 'CL',
    category: 'physical',
    summary: 'Gravity settling. Performance set by the surface overflow rate versus particle settling velocity.',
    params: [
      { key: 'area', label: 'Surface area', unit: 'm²', min: 1, max: 5000, step: 1, default: (Q) => round(Q / 24 / 0.5, 1), help: 'Chemical floc: ≤ 1.0–1.5 m/h; activated sludge: ≤ 0.7–1.2 m/h at peak.' },
      { key: 'depth', label: 'Side-water depth', unit: 'm', min: 2, max: 6, step: 0.5, default: () => 3.5 },
      { key: 'plateArea', label: 'Lamella plate area (0 = conventional)', unit: 'm²', min: 0, max: 20000, step: 5, default: () => 0, help: 'Inclined plates at 55° multiply the settling area in the same footprint (chemical floc only). ≈ 8–12 m² of plate per m² of tank.' },
    ],
    run: (s, p) => clarify(s, { area_m2: n(p, 'area'), depth_m: n(p, 'depth'), plateArea_m2: Number(p.plateArea ?? 0) || 0 }),
    // verify: lamella plate packs ≈ RM 450 per m² projected plate area installed (GAME MODEL)
    capex: (p) => scale(200_000, n(p, 'area') * (n(p, 'depth') / 3.5), 40) + 450 * (Number(p.plateArea ?? 0) || 0),
    footprint: (p) => n(p, 'area') * 1.2,
  },
  activatedSludge: {
    type: 'activatedSludge',
    name: 'Activated Sludge',
    tagPrefix: 'AS',
    category: 'biological',
    summary: 'Aerated suspended-growth reactor. Removes biodegradable organics (and NH₄ at long SRT). Needs a secondary clarifier.',
    params: [
      { key: 'volume', label: 'Aeration volume', unit: 'm³', min: 10, max: 50000, step: 10, default: (Q) => round(Q * 1.5, 10) },
      { key: 'srt', label: 'Sludge age (SRT)', unit: 'd', min: 1, max: 40, step: 0.5, default: () => 12 },
      { key: 'do', label: 'DO set-point', unit: 'mg/L', min: 0.2, max: 4, step: 0.1, default: () => 2.0 },
    ],
    run: (s, p, ctx) => activatedSludge(s, { volume_m3: n(p, 'volume'), srt_d: n(p, 'srt'), do_mgL: n(p, 'do') }, ctx),
    capex: (p, _s, r) => scale(450_000, n(p, 'volume'), 500) + scale(150_000, Math.max(r.calcs.o2?.value ?? 1, 1), 500) * (0.8 + 0.1 * n(p, 'do')),
    footprint: (p) => (n(p, 'volume') / 5) * 1.2 + 30,
  },
  sandFilter: {
    type: 'sandFilter',
    name: 'Sand Filter',
    tagPrefix: 'SF',
    category: 'physical',
    summary: 'Depth filtration polishes residual floc and precipitate. Capture falls as filtration rate rises.',
    params: [
      { key: 'area', label: 'Filter area', unit: 'm²', min: 0.5, max: 2000, step: 0.5, default: (Q) => round(Q / 24 / 6, 0.5), help: 'Rapid sand filters: 5–10 m/h.' },
      { key: 'depth', label: 'Bed depth', unit: 'm', min: 0.5, max: 2, step: 0.1, default: () => 1.0 },
    ],
    run: (s, p) => filter(s, { area_m2: n(p, 'area'), depth_m: n(p, 'depth') }),
    capex: (p) => scale(140_000, n(p, 'area'), 5) * (0.8 + 0.2 * n(p, 'depth')),
    footprint: (p) => n(p, 'area') * 2 + 6,
  },
  carbon: {
    type: 'carbon',
    name: 'Activated Carbon (GAC)',
    tagPrefix: 'AC',
    category: 'physical',
    summary: 'Adsorbs non-biodegradable dissolved organics (inert COD) that biology cannot remove. Polishing only: feed must be low in solids.',
    params: [{ key: 'ebct', label: 'Empty-bed contact time', unit: 'min', min: 2, max: 60, step: 1, default: () => 15, help: 'EBCT 10–15 min is typical; carbon is consumed in proportion to the COD removed.' }],
    run: (s, p) => adsorb(s, { ebct_min: n(p, 'ebct') }),
    capex: (p, s) => scale(220_000, Math.max((s.Q / 1440) * n(p, 'ebct'), 0.5), 10),
    footprint: (p) => 20 + n(p, 'ebct') * 0.8,
  },
  thickener: {
    type: 'thickener',
    name: 'Sludge Thickener',
    tagPrefix: 'TH',
    category: 'sludge',
    summary: 'Gravity thickening of dilute sludge (≈1 %) to 2.5–3 %. Supernatant returns to the plant; underflow goes on to dewatering.',
    params: [{ key: 'area', label: 'Surface area', unit: 'm²', min: 1, max: 2000, step: 1, default: () => 10, help: 'Sized on solids loading: ≈20 kg/m²·d for chemical sludge, ≈30 for biological.' }],
    run: (s, p) => thicken(s, { area_m2: n(p, 'area') }),
    capex: (p) => scale(120_000, n(p, 'area'), 20),
    footprint: (p) => n(p, 'area') * 1.3 + 5,
  },
  filterPress: {
    type: 'filterPress',
    name: 'Filter Press',
    tagPrefix: 'FP',
    category: 'sludge',
    summary: 'Recessed-plate filter press: dewaters sludge to a 20–35 % DS cake for disposal. Filtrate returns to the plant.',
    params: [
      { key: 'volume', label: 'Chamber volume', unit: 'm³', min: 0.05, max: 50, step: 0.05, default: () => 0.5, help: 'Total cake chamber volume per batch.' },
      { key: 'cycles', label: 'Cycles per day', unit: '/d', min: 0.5, max: 6, step: 0.5, default: () => 3, help: '4–6 h per cycle including filling, squeeze and cake discharge.' },
      { key: 'conditioning', label: 'Conditioning', unit: '', options: [{ value: 'polymer', label: 'Polymer (cationic PAM)' }, { value: 'lime', label: 'Lime (drier, heavier cake)' }], default: () => 'polymer' },
    ],
    run: (s, p) => filterPress(s, { chamber_m3: n(p, 'volume'), cycles: n(p, 'cycles'), conditioning: (p.conditioning as 'polymer' | 'lime') ?? 'polymer' }),
    capex: (p) => scale(250_000, n(p, 'volume'), 1),
    footprint: (p) => 25 + 30 * n(p, 'volume'),
  },
  splitter: {
    type: 'splitter',
    name: 'Flow Splitter',
    tagPrefix: 'SP',
    category: 'hydraulic',
    summary: 'Weir box splitting a stream between two outlets (a / b) — for parallel trains or partial bypass.',
    params: [{ key: 'split', label: 'Flow to outlet a', unit: '%', min: 0, max: 100, step: 1, default: () => 50 }],
    run: (s) => passThrough(s),
    capex: () => 8_000,
    footprint: () => 2,
  },
  mixer: {
    type: 'mixer',
    name: 'Mixing Box',
    tagPrefix: 'MX',
    category: 'hydraulic',
    summary: 'Combines several streams (e.g. raw wastewater with filtrate return). Any unit with several inlets also mixes them.',
    params: [],
    run: (s) => passThrough(s),
    capex: () => 6_000,
    footprint: () => 2,
  },
};

export function defaultParams(type: UnitType, Q: number): Params {
  const p: Params = {};
  for (const d of CATALOGUE[type].params) p[d.key] = d.default(Q);
  return p;
}

/** Indicative unit prices for OPEX display (RM). GAME MODEL; Phase 2 makes these market-driven. */
export const PRICES = {
  electricity_kWh: 0.5,
  sludgeDisposal_kg: { metal: 1.2, other: 0.3 },
  /** verify: disposal gate price per WET kg at a disposal point (metal sludge = scheduled waste SW 204). GAME MODEL */
  disposalWet_kg: { metal: 0.18, other: 0.06 },
};
