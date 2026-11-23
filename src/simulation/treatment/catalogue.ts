/**
 * Treatment unit catalogue: design inputs, process model binding, CAPEX and footprint.
 * Ref: knowledge/processes/*.md (technology profiles)
 *
 * CAPEX — GAME MODEL six-tenths rule: C = C_ref · (size / size_ref)^0.6  (RM, 2026 Malaysian price level, indicative).
 */
import { Stream } from '../core/stream';
import { activatedSludgeControlled } from '../biological/activatedSludge';
import { isAlkReagent } from '../biological/aeration';
import { Coagulant, COAGULANTS, coagulate } from '../chemistry/coagulation';
import { neutralise } from '../chemistry/neutralisation';
import { reduceChromium } from '../chemistry/chromiumReduction';
import { adsorb } from '../physical/carbon';
import { clarify, equalise, filter, separateOil } from '../physical/units';
import { flotate } from '../physical/flotation';
import { dry } from '../physical/dryer';
import { precipitateSulfide } from '../chemistry/sulfide';
import { reverseOsmosis, ultrafilter } from '../physical/membranes';
import { ionExchange } from '../chemistry/ionExchange';
import { evaporate } from '../physical/evaporator';
import { electrowin } from '../chemistry/electrowinning';
import { fenton } from '../chemistry/fenton';
import { uasb } from '../biological/uasb';
import { membraneBioreactor } from '../biological/mbr';
import { ProcessResult } from './types';
import { filterPress, passThrough, thicken } from '../physical/sludge';

export type UnitType = 'eq' | 'oilSep' | 'daf' | 'crReduction' | 'neutralisation' | 'precipitation' | 'sulfide' | 'coagulation' | 'clarifier' | 'activatedSludge' | 'sandFilter' | 'carbon' | 'thickener' | 'filterPress' | 'dryer' | 'uf' | 'ro' | 'ionExchange' | 'evaporator' | 'electrowinning' | 'aop' | 'uasb' | 'mbr' | 'splitter' | 'mixer';
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
  daf: {
    type: 'daf',
    name: 'Dissolved-Air Flotation (DAF)',
    tagPrefix: 'DAF',
    category: 'physical',
    summary: 'Pressurised recycle releases micro-bubbles that float oil, grease and light floc; float is skimmed to the sludge line. Emulsions must be broken by coagulation first.',
    params: [
      { key: 'area', label: 'Flotation area', unit: 'm²', min: 1, max: 500, step: 0.5, default: (Q) => round((Q * (2.0 + 0.3)) / 24 / 8, 0.5), help: 'Hydraulic loading (peak feed + recycle) 5–12 m/h. Sized for a peak of 2× — less area is needed after an EQ tank.' },
      { key: 'recycle', label: 'Pressurised recycle', unit: '% of avg Q', min: 5, max: 100, step: 5, default: () => 30, help: 'Percent of the average design flow. Sets the air-to-solids ratio: aim for A/S 0.02–0.04 mL/mg on oily feeds.' },
      { key: 'pressure', label: 'Saturator pressure', unit: 'kPa(g)', min: 200, max: 700, step: 10, default: () => 450, help: '350–600 kPa(g) is typical; more pressure dissolves more air.' },
    ],
    run: (s, p) => flotate(s, { area_m2: n(p, 'area'), recycle_pct: n(p, 'recycle'), pressure_kPa: n(p, 'pressure') }),
    capex: (p, _s, r) => scale(250_000, n(p, 'area'), 10) + scale(60_000, Math.max(Number(r.calcs.rec?.value ?? 0), 5), 100),
    footprint: (p) => n(p, 'area') * 1.6 + 8,
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
  sulfide: {
    type: 'sulfide',
    name: 'Sulfide Precipitation',
    tagPrefix: 'SF',
    category: 'chemical',
    summary: 'NaHS dosing precipitates Ni, Cu and Zn as metal sulfides — far less soluble than hydroxides, and it breaks the metal complexes (citrate, ammonia) that hydroxide cannot touch. The fine sulfide must be coagulated afterwards.',
    params: [
      { key: 'dose', label: 'NaHS dose (as 100 %)', unit: 'mg/L', min: 0, max: 500, step: 1, default: () => 20, help: 'About 1 mg/L NaHS per mg/L metal (≈ 0.95 mg NaHS per mg Ni); dose 1.1–1.3× stoichiometric.' },
      { key: 'volume', label: 'Reactor volume', unit: 'm³', min: 0.5, max: 2000, step: 0.5, default: (Q) => round(Q / 48, 0.5), help: '15–30 min reaction time.' },
    ],
    run: (s, p) => precipitateSulfide(s, { dose_mgL: n(p, 'dose'), volume_m3: n(p, 'volume') }),
    capex: (p) => scale(70_000, n(p, 'volume'), 10) + 55_000,
    footprint: (p) => n(p, 'volume') / 2.5 + 10,
  },
  ionExchange: {
    type: 'ionExchange',
    name: 'Ion Exchange (chelating resin)',
    tagPrefix: 'IX',
    category: 'chemical',
    summary: 'Lead–lag columns of chelating resin take the last traces of dissolved Cu, Ni and Zn. Acid regeneration concentrates the metal into a small eluate (reject outlet). Polishing only — feed must be filtered and low in metal.',
    params: [
      { key: 'resin', label: 'Resin volume (per column)', unit: 'm³', min: 0.05, max: 100, step: 0.05, default: (Q) => round(Q / 24 / 12, 0.05), help: 'Service flow 8–20 bed volumes per hour.' },
    ],
    run: (s, p) => ionExchange(s, { resin_m3: n(p, 'resin') }),
    capex: (p) => scale(160_000, n(p, 'resin'), 2) + 60_000,
    footprint: (p) => n(p, 'resin') * 3 + 15,
  },
  electrowinning: {
    type: 'electrowinning',
    name: 'Electrowinning Cell',
    tagPrefix: 'EW',
    category: 'chemical',
    summary: 'DC current plates copper (then nickel) out of a liquor as saleable cathode metal. Concentrated liquor (IX eluate, drag-out) at high current density; a dilute segregated rinse (a few hundred mg/L) at low current density on a large cathode area. Spent electrolyte goes back to treatment.',
    params: [
      { key: 'area', label: 'Cathode area', unit: 'm²', min: 0.5, max: 1000, step: 0.5, default: () => 10, help: 'Recovery is mass-transfer limited: a well-mixed cell leaves C_in/(1 + k_m·A/Q). For 80 % recovery A ≈ 4·Q/k_m (≈ 4.6 m² per m³/d with plate cathodes).' },
      { key: 'j', label: 'Current density', unit: 'A/m²', min: 5, max: 600, step: 5, default: () => 200, help: 'Keep it near the limiting current density i_L = 2·F·k_m·C (plate: ≈ 10 A/m² at 300 mg/L Ni, ≈ 330 A/m² at 10 g/L; rotating cylinder: 10× that); above it the extra current only makes hydrogen. Plate cathodes 150–300 A/m² in g/L liquors, 5–20 A/m² for dilute rinses.' },
      {
        key: 'cathode',
        label: 'Cathode type',
        unit: '',
        options: [
          { value: 'plate', label: 'Plate cathodes (sheet metal, full price)' },
          { value: 'rce', label: 'Rotating cylinder (dilute rinses: ~1/10 the area)' },
        ],
        default: () => 'plate',
        help: 'Rotating cylinder: the spinning cathode gives ~10× the mass transfer, so a dilute rinse needs about a tenth of the cathode area. It costs more per m² and needs motor power, and the metal comes off as powder (sold at ~90 % of the cathode price).',
      },
    ],
    run: (s, p) => electrowin(s, { area_m2: n(p, 'area'), currentDensity: n(p, 'j'), cathode: String(p.cathode ?? 'plate') }),
    // cells, cathodes and anodes scale with cathode area (RCE ×2.5 per m²: drives, seals, scrapers); the rectifier with the current (GAME MODEL, verify)
    capex: (p) => scale(p.cathode === 'rce' ? 200_000 : 80_000, n(p, 'area'), 10) + scale(40_000, n(p, 'area') * n(p, 'j'), 2000) + 40_000,
    footprint: (p) => n(p, 'area') / 2 + 12,
  },
  aop: {
    type: 'aop',
    name: 'Fenton Oxidation (AOP)',
    tagPrefix: 'OX',
    category: 'chemical',
    summary: 'Acidify to pH 3, dose iron + hydrogen peroxide: hydroxyl radicals destroy refractory (inert) COD that biology cannot. Neutralised afterwards — the iron floc needs a clarifier.',
    params: [
      { key: 'h2o2', label: 'H₂O₂ dose (as 100 %)', unit: 'mg/L', min: 0, max: 5000, step: 10, default: () => 200, help: '≈ 2.1 g H₂O₂ per g COD in theory; field use 4–8 g/g (30–60 % utilisation).' },
      { key: 'fe', label: 'Fe : H₂O₂ ratio', unit: 'w/w', min: 0, max: 0.5, step: 0.01, default: () => 0.1, help: '0.1–0.2 by mass.' },
      { key: 'pHset', label: 'Reaction pH', unit: '', min: 2, max: 7, step: 0.1, default: () => 3.0 },
      { key: 'volume', label: 'Reactor volume', unit: 'm³', min: 0.5, max: 5000, step: 0.5, default: (Q) => round(Q / 24, 0.5), help: '45–90 min reaction time.' },
    ],
    run: (s, p) => fenton(s, { h2o2_mgL: n(p, 'h2o2'), feRatio: n(p, 'fe'), pHset: n(p, 'pHset'), volume_m3: n(p, 'volume') }),
    capex: (p) => scale(150_000, n(p, 'volume'), 20) + 90_000,
    footprint: (p) => n(p, 'volume') / 3 + 20,
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
      { key: 'desludge', label: 'Desludge pump flow (0 = auto)', unit: 'm³/d', min: 0, max: 5000, step: 0.1, default: () => 0, help: 'Auto draws exactly the settled sludge at its typical underflow concentration. Set a flow to fix the pump: too little → the blanket rises and sludge goes over the weir; too much → thin sludge. Not used after activated sludge (WAS is set by the RAS system).' },
      { key: 'plateArea', label: 'Lamella plate area (0 = conventional)', unit: 'm²', min: 0, max: 20000, step: 5, default: () => 0, help: 'Inclined plates at 55° multiply the settling area in the same footprint (chemical floc only). ≈ 8–12 m² of plate per m² of tank.' },
    ],
    run: (s, p) => clarify(s, { area_m2: n(p, 'area'), depth_m: n(p, 'depth'), plateArea_m2: Number(p.plateArea ?? 0) || 0, desludge_m3d: Number(p.desludge ?? 0) || 0 }),
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
      { key: 'control', label: 'Wasting control', unit: '', options: [{ value: 'mlss', label: 'Hold MLSS set-point (industry practice)' }, { value: 'srt', label: 'Hold sludge age (SRT)' }], default: () => 'mlss', help: 'Operators usually target MLSS and adjust WAS to hold it; the resulting SRT is shown below.' },
      { key: 'mlss', label: 'MLSS set-point', unit: 'mg/L', min: 500, max: 8000, step: 100, default: () => 3000, help: 'Used in MLSS control. Typical 2,000–4,500 mg/L for a gravity clarifier.' },
      { key: 'srt', label: 'Sludge age (SRT)', unit: 'd', min: 1, max: 40, step: 0.5, default: () => 12, help: 'Used in SRT control.' },
      { key: 'ras', label: 'RAS ratio (Qr/Q)', unit: '', min: 0.1, max: 2, step: 0.05, default: () => 0.75, help: 'Return activated sludge from the clarifier underflow; sets the underflow (WAS) concentration Xr = X(1+R)/R.' },
      { key: 'do', label: 'DO set-point', unit: 'mg/L', min: 0.2, max: 4, step: 0.1, default: () => 2.0 },
      { key: 'alkPH', label: 'Alkalinity dosing: hold pH ≥', unit: '', min: 0, max: 8.5, step: 0.1, default: () => 0, help: '0 = off. A pH controller doses alkali into the tank so it never runs below this pH. Nitrification consumes 7.1 mg CaCO₃ per mg N and slows below pH ≈ 7.' },
      { key: 'alkReagent', label: 'Alkali reagent', unit: '', options: [{ value: 'NaOH', label: 'Caustic soda (NaOH)' }, { value: 'Na2CO3', label: 'Soda ash (Na₂CO₃)' }, { value: 'NaHCO3', label: 'Sodium bicarbonate (NaHCO₃)' }, { value: 'lime', label: 'Hydrated lime (Ca(OH)₂)' }], default: () => 'NaOH' },
    ],
    run: (s, p, ctx) =>
      activatedSludgeControlled(s, { volume_m3: n(p, 'volume'), srt_d: n(p, 'srt'), do_mgL: n(p, 'do'), alkPH: Number(p.alkPH ?? 0) || 0, alkReagent: isAlkReagent(p.alkReagent) ? p.alkReagent : 'NaOH', control: p.control === 'mlss' ? 'mlss' : 'srt', mlssTarget_mgL: Number(p.mlss ?? 3000) || 3000, ras: Number(p.ras ?? 0.75) || 0.75 }, ctx),
    capex: (p, _s, r) => scale(450_000, n(p, 'volume'), 500) + scale(150_000, Math.max(r.calcs.o2?.value ?? 1, 1), 500) * (0.8 + 0.1 * n(p, 'do')) + ((Number(p.alkPH ?? 0) || 0) > 0 ? 35_000 : 0), // alkali day tank, metering pump, pH probe
    footprint: (p) => (n(p, 'volume') / 5) * 1.2 + 30,
  },
  uasb: {
    type: 'uasb',
    name: 'UASB Anaerobic Reactor',
    tagPrefix: 'AN',
    category: 'biological',
    summary: 'Granular anaerobic sludge blanket turns high-strength COD into methane — little sludge, no aeration, and the biogas runs a gas engine. Leaves 10–30 % of the COD and the ammonia: aerobic polishing must follow.',
    params: [
      { key: 'volume', label: 'Reactor volume', unit: 'm³', min: 10, max: 50000, step: 10, default: (Q) => round(Q * 0.5, 10), help: 'Size on 5–15 kg COD/m³·d and ≤ 1 m/h upflow.' },
    ],
    run: (s, p) => uasb(s, { volume_m3: n(p, 'volume') }),
    capex: (p) => scale(700_000, n(p, 'volume'), 1000) + 250_000, // reactor + gas handling, flare, CHP
    footprint: (p) => n(p, 'volume') / 6 + 60,
  },
  mbr: {
    type: 'mbr',
    name: 'Membrane Bioreactor (MBR)',
    tagPrefix: 'MB',
    category: 'biological',
    summary: 'Activated sludge at 8–12 g/L MLSS with submerged membranes instead of a clarifier: a third of the footprint, solids-free permeate fit for RO. Waste sludge leaves from the sludge outlet.',
    params: [
      { key: 'volume', label: 'Bioreactor volume', unit: 'm³', min: 10, max: 30000, step: 10, default: (Q) => round(Q * 0.6, 10) },
      { key: 'mlss', label: 'MLSS set-point', unit: 'mg/L', min: 3000, max: 18000, step: 500, default: () => 10000 },
      { key: 'area', label: 'Membrane area', unit: 'm²', min: 10, max: 200000, step: 10, default: (Q) => round((Q * 1000) / 24 / 20, 10), help: 'Design flux 15–25 L/m²·h.' },
      { key: 'do', label: 'DO set-point', unit: 'mg/L', min: 0.5, max: 4, step: 0.1, default: () => 2.0 },
    ],
    run: (s, p) => membraneBioreactor(s, { volume_m3: n(p, 'volume'), mlss_mgL: n(p, 'mlss'), area_m2: n(p, 'area'), do_mgL: n(p, 'do') }),
    capex: (p) => scale(450_000, n(p, 'volume'), 500) + scale(300_000, n(p, 'area'), 2000),
    footprint: (p) => n(p, 'volume') / 5 + n(p, 'area') / 400 + 25,
  },
  uf: {
    type: 'uf',
    name: 'Ultrafiltration (UF)',
    tagPrefix: 'UF',
    category: 'physical',
    summary: 'Hollow-fibre membranes (≈ 0.02 µm) take out suspended solids, colloids and emulsion almost completely. Backwash water leaves from the reject outlet. The pretreatment for RO.',
    params: [
      { key: 'area', label: 'Membrane area', unit: 'm²', min: 5, max: 100000, step: 5, default: (Q) => round((Q * 1000) / 24 / 50, 5), help: 'Design net flux 30–60 L/m²·h.' },
      { key: 'recovery', label: 'Recovery', unit: '%', min: 70, max: 98, step: 1, default: () => 92, help: 'The rest is backwash/CEB water (reject outlet).' },
    ],
    run: (s, p) => ultrafilter(s, { area_m2: n(p, 'area'), recovery_pct: n(p, 'recovery') }),
    capex: (p) => scale(300_000, n(p, 'area'), 1000) + 60_000,
    footprint: (p) => n(p, 'area') / 150 + 20,
  },
  ro: {
    type: 'ro',
    name: 'Reverse Osmosis (RO)',
    tagPrefix: 'RO',
    category: 'physical',
    summary: 'High-pressure polyamide membranes reject ~98 % of dissolved salts and metals: reuse-grade permeate and a concentrated brine (reject outlet). Feed must be particle-free (UF).',
    params: [
      { key: 'recovery', label: 'Recovery', unit: '%', min: 30, max: 95, step: 1, default: () => 70, help: '60–75 % typical; higher needs antiscalant and low-scaling feed.' },
      { key: 'antiscalant', label: 'Antiscalant dosing', unit: '', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], default: () => 'yes' },
    ],
    run: (s, p) => reverseOsmosis(s, { recovery_pct: n(p, 'recovery'), antiscalant: p.antiscalant !== 'no' }),
    capex: (_p, s) => scale(450_000, Math.max(s.Q, 1), 500) + 80_000,
    footprint: () => 60,
  },
  evaporator: {
    type: 'evaporator',
    name: 'Vacuum Evaporator (MVR)',
    tagPrefix: 'EV',
    category: 'physical',
    summary: 'Boils the water off under vacuum with a vapour compressor: near-pure distillate (main outlet) and a small concentrate (reject outlet) for haulage or drying. The end of a zero-liquid-discharge line.',
    params: [
      { key: 'recovery', label: 'Distillate recovery', unit: '%', min: 10, max: 99, step: 1, default: () => 90, help: 'Limited by salt saturation of the concentrate (~300 g/L).' },
    ],
    run: (s, p) => evaporate(s, { recovery_pct: n(p, 'recovery') }),
    capex: (p, s) => scale(900_000, Math.max(s.Q * n(p, 'recovery') / 100, 0.5), 20) + 150_000,
    footprint: () => 50,
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
    params: [{ key: 'ebct', label: 'Empty-bed contact time', unit: 'min', min: 2, max: 60, step: 1, default: () => 15, help: 'EBCT 10–15 min is typical.' }],
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
    params: [{ key: 'area', label: 'Surface area', unit: 'm²', min: 1, max: 2000, step: 1, default: (Q) => Math.max(4, Math.ceil(Q / 8)), help: 'Sized on solids loading: ≈20 kg/m²·d for chemical sludge, ≈30 for biological.' },
      { key: 'mode', label: 'Operation', unit: '', options: [{ value: 'thicken', label: 'Thicken (decant supernatant)' }, { value: 'holding', label: 'Holding tank (no decant, all to press)' }], default: () => 'thicken', help: 'Holding: nothing is decanted; the outlet is an emergency overflow. The press then gets the thinner clarifier sludge.' },
    ],
    run: (s, p) => thicken(s, { area_m2: n(p, 'area'), mode: p.mode === 'holding' ? 'holding' : 'thicken' }),
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
  dryer: {
    type: 'dryer',
    name: 'Sludge Dryer',
    tagPrefix: 'DR',
    category: 'sludge',
    summary: 'Indirect thermal dryer: evaporates cake moisture to 70–90 % dry solids, cutting scheduled-waste tonnage 3–4×. LPG-fired; condensate returns to the works.',
    params: [{ key: 'targetDS', label: 'Product dry solids', unit: '%', min: 40, max: 95, step: 5, default: () => 80, help: '80–85 % is typical; above 90 % granules get dusty and can self-heat.' }],
    run: (s, p) => dry(s, { targetDS_pct: n(p, 'targetDS') }),
    capex: (_p, _s, r) => scale(650_000, Math.max(Number(r.calcs.evapH?.value ?? 0), 5), 100),
    footprint: () => 40,
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
/**
 * Chemical storage and dosing system per chemical a unit consumes (GAME MODEL, verify against vendor budget prices):
 * bunded storage for ~14 days of use, duty/standby metering pumps, day tank and pipework. RM 45k at 100 kg/d (as
 * supplied product), six-tenths rule, RM 8k minimum — so high-dose plants (large-flow coagulation, lime softening,
 * acid cracking) carry the storage and pumping their tonnes per day need. Ref: knowledge/processes/costing.md
 */
export function chemicalSystemCapex(chemicals: { kgPerDay: number }[]): number {
  return chemicals.reduce((a, c) => a + (c.kgPerDay > 0.01 ? Math.max(8_000, 45_000 * Math.pow(c.kgPerDay / 100, 0.6)) : 0), 0);
}

export const PRICES = {
  electricity_kWh: 0.5,
  sludgeDisposal_kg: { metal: 1.2, other: 0.3 },
  /** verify: disposal gate price per WET kg at a disposal point (metal sludge = scheduled waste SW 204). GAME MODEL */
  disposalWet_kg: { metal: 0.18, other: 0.06 },
  /** verify: licensed scheduled-waste tanker haulage of LIQUID waste per m³ (metal-bearing liquor vs general). GAME MODEL */
  liquidHaul_m3: { metal: 900, other: 350 },
  /** tanker load used for the "loads per day" check, m³ */
  tanker_m3: 10,
  /** verify: value of reclaimed water to the client = avoided industrial water tariff (Malaysia ~RM 2–3.5/m³), RM/m³. GAME MODEL */
  reuseCredit_m3: 3.0,
};
