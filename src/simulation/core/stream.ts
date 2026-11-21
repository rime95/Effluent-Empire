/**
 * Wastewater stream state. Ref: knowledge/README.md (stream model), knowledge/chemistry/acid_base_chemistry.md
 *
 * Design: the stream stores *conserved totals* (strong-ion balance, carbonate total, metal totals split into
 * dissolved/precipitated) so that blending is linear and pH is always re-derived from charge balance.
 * Solids are grouped into "pools", each with a median settling velocity v50 used by separation units.
 */
import { COD_PER_VSS, MW, N_PER_VSS } from './units';

/** Hydroxide-forming metals. Ni, Cu, Zn are divalent; Cr here is Cr(III). Cr(VI) (chromate) is tracked separately. */
export const METALS = ['Ni', 'Cu', 'Zn', 'Cr'] as const;
export type Metal = (typeof METALS)[number];
export type MetalMap = Record<Metal, number>;

export const POOLS = ['grit', 'inert', 'colloid', 'floc', 'organic', 'precipitate', 'alFloc', 'feFloc', 'biomass'] as const;
export type Pool = (typeof POOLS)[number];

export interface Stream {
  /** flow, m³/d (average) */
  Q: number;
  /** ratio of peak hourly flow to average flow (≥1). Hydraulic units are checked at peak. */
  peakFactor: number;
  /** temperature, °C */
  T: number;
  /** pH (derived from charge balance; cached after every equilibration) */
  pH: number;

  // ---- acid-base totals (mol/L, eq/L) ----
  /** net strong ions: Σ strong cations − Σ strong anions, eq/L (excludes H+, dissolved metals (incl. coagulant Al/Fe) and SULFATE). Includes NH4+ (treated as strong cation, valid pH < 8.5). */
  Cb: number;
  /** total inorganic carbon C_T = [H2CO3*]+[HCO3-]+[CO3 2-], mol/L */
  CT: number;
  /** total sulfate (HSO4− + SO4 2−), mol/L — tracked explicitly because HSO4− (pKa 1.99) buffers the acid range. Optional for pre-sulfate saves (then folded into Cb). */
  SO4T?: number;
  /** organic weak acid (e.g. volatile fatty acids) total, mol/L */
  weakAcidT: number;
  weakAcidPKa: number;

  // ---- metals, mg/L as metal ----
  dissolved: MetalMap;
  precipitated: MetalMap;
  /** coagulant-derived solids, mg/L as metal (Al in Al(OH)3, Fe in Fe(OH)3) */
  alSolid: number;
  feSolid: number;
  /** hexavalent chromium (HCrO4− / CrO4 2−), mg/L as Cr — an anion: does not precipitate as hydroxide */
  CrVI: number;
  /** dissolved aluminium (Al3+, AlOH2+, Al(OH)4−) in equilibrium with Al(OH)3(am), mg/L as Al — set by equilibrate() */
  alDissolved: number;
  /** dissolved ferric iron (Fe3+, FeOH2+, Fe(OH)2+, Fe(OH)4−) in equilibrium with Fe(OH)3(am), mg/L as Fe — set by equilibrate(); optional for old saves */
  feDissolved?: number;

  // ---- organics, mg COD/L (ASM-style fractions) ----
  /** readily biodegradable soluble */
  SS: number;
  /** inert soluble */
  SI: number;
  /** slowly biodegradable particulate */
  XS: number;
  /** inert particulate */
  XI: number;
  /** biomass + cell debris, mg VSS/L (COD = 1.42·biomass) */
  biomass: number;

  /** oil & grease, mg/L (tracked separately from COD fractions — GAME MODEL simplification) */
  OGfree: number;
  OGemulsified: number;

  // ---- nitrogen, mg N/L ----
  NH4N: number;
  NO3N: number;

  // ---- mineral solids, mg/L ----
  grit: number;
  inert: number;
  /** colloidal, non-settleable unless destabilised by coagulation */
  colloid: number;
  /** destabilised colloid enmeshed in floc */
  floc: number;

  /** median settling velocity per pool, m/h */
  v50: Record<Pool, number>;

  /** activated-sludge mixed-liquor context for a downstream secondary clarifier */
  ml?: { mlss: number; srt: number; clarifierFollows: boolean; /** RAS ratio Qr/Q */ ras?: number; /** RAS/WAS underflow solids, mg/L */ xr?: number };
}

export const DEFAULT_V50: Record<Pool, number> = {
  grit: 40,
  inert: 2.0,
  colloid: 0.005,
  floc: 2.5,
  organic: 0.8,
  precipitate: 0.15,
  alFloc: 2.5,
  feFloc: 3.0,
  biomass: 3.0,
};

const zeroMetals = (): MetalMap => ({ Ni: 0, Cu: 0, Zn: 0, Cr: 0 });

export function emptyStream(Q = 0): Stream {
  return {
    Q,
    peakFactor: 1,
    T: 25,
    pH: 7,
    Cb: 0,
    CT: 0,
    SO4T: 0,
    weakAcidT: 0,
    weakAcidPKa: 4.76,
    dissolved: zeroMetals(),
    precipitated: zeroMetals(),
    alSolid: 0,
    feSolid: 0,
    alDissolved: 0,
    feDissolved: 0,
    CrVI: 0,
    SS: 0,
    SI: 0,
    XS: 0,
    XI: 0,
    biomass: 0,
    OGfree: 0,
    OGemulsified: 0,
    NH4N: 0,
    NO3N: 0,
    grit: 0,
    inert: 0,
    colloid: 0,
    floc: 0,
    v50: { ...DEFAULT_V50 },
  };
}

export function cloneStream(s: Stream): Stream {
  return {
    ...s,
    dissolved: { ...s.dissolved },
    precipitated: { ...s.precipitated },
    v50: { ...s.v50 },
    ml: s.ml ? { ...s.ml } : undefined,
    feDissolved: s.feDissolved ?? 0,
  };
}

const HYDROXIDE_MW: Record<Metal, number> = { Ni: MW.NiOH2, Cu: MW.CuOH2, Zn: MW.ZnOH2, Cr: MW.CrOH3 };

/** Dry-solids mass of each pool, mg/L. */
export function poolMass(s: Stream, p: Pool): number {
  switch (p) {
    case 'grit':
      return s.grit;
    case 'inert':
      return s.inert;
    case 'colloid':
      return s.colloid;
    case 'floc':
      return s.floc;
    case 'organic':
      // particulate organics: COD -> VSS (GAME MODEL: VSS/TSS = 1 for organic particulates)
      return (s.XS + s.XI) / COD_PER_VSS;
    case 'precipitate':
      return METALS.reduce((a, m) => a + (s.precipitated[m] * HYDROXIDE_MW[m]) / MW[m], 0);
    case 'alFloc':
      return (s.alSolid * MW.AlOH3) / MW.Al;
    case 'feFloc':
      return (s.feSolid * MW.FeOH3) / MW.Fe;
    case 'biomass':
      return s.biomass;
  }
}

/** Total suspended solids, mg/L */
export function tss(s: Stream): number {
  return POOLS.reduce((a, p) => a + poolMass(s, p), 0);
}

/** Total COD, mg/L (excludes O&G — see knowledge/README.md) */
export function codTotal(s: Stream): number {
  return s.SS + s.SI + s.XS + s.XI + COD_PER_VSS * s.biomass;
}

/**
 * BOD5 estimate, mg/L. Ref: knowledge/biological/activated_sludge.md §BOD
 *   BODu ≈ 0.90·bCOD (part of bCOD becomes non-oxidised cell residue, M&E: bCOD/BODu = 1/(1 − 1.42·fd·Y));
 *   BOD5/BODu = 0.68 (k = 0.23 /d)  -> bCOD contributes 0.61 mg BOD5 per mg COD.
 *   Biomass pool (active + debris + enmeshed inerts): ≈ 0.5 mg BOD5 per mg VSS (rule of thumb 0.5–0.65 mg BOD5/mg TSS).
 */
export const BOD5_PER_BCOD = 0.68 * 0.9;
export const BOD5_PER_VSS = 0.5;
export function bod5(s: Stream): number {
  return BOD5_PER_BCOD * (s.SS + s.XS) + BOD5_PER_VSS * s.biomass;
}

export function metalTotal(s: Stream, m: Metal): number {
  return s.dissolved[m] + s.precipitated[m];
}

export function oilGrease(s: Stream): number {
  return s.OGfree + s.OGemulsified;
}

/** Total N excluding organic N (not modelled in Phase 1), mg/L */
export function nitrogenTotal(s: Stream): number {
  return s.NH4N + s.NO3N + N_PER_VSS * s.biomass;
}

/** Flow-weighted blend of several streams (mixer). pH must be re-equilibrated afterwards. */
export function blend(streams: Stream[]): Stream {
  const live = streams.filter((s) => s.Q > 0);
  const Q = live.reduce((a, s) => a + s.Q, 0);
  const out = emptyStream(Q);
  if (Q <= 0) return out;
  const w = (f: (s: Stream) => number) => live.reduce((a, s) => a + f(s) * s.Q, 0) / Q;
  out.peakFactor = w((s) => s.peakFactor);
  out.T = w((s) => s.T);
  out.pH = w((s) => s.pH); // provisional; equilibrate() recomputes
  out.Cb = w((s) => s.Cb);
  out.CT = w((s) => s.CT);
  out.weakAcidT = w((s) => s.weakAcidT);
  out.weakAcidPKa = live[0].weakAcidPKa;
  for (const m of METALS) {
    out.dissolved[m] = w((s) => s.dissolved[m]);
    out.precipitated[m] = w((s) => s.precipitated[m]);
  }
  const scalarKeys = ['SO4T', 'alSolid', 'feSolid', 'alDissolved', 'feDissolved', 'CrVI', 'SS', 'SI', 'XS', 'XI', 'biomass', 'OGfree', 'OGemulsified', 'NH4N', 'NO3N', 'grit', 'inert', 'colloid', 'floc'] as const;
  for (const k of scalarKeys) out[k] = w((s) => s[k] ?? 0);
  // settling velocity: mass-weighted average per pool
  for (const p of POOLS) {
    const m = live.reduce((a, s) => a + poolMass(s, p) * s.Q, 0);
    out.v50[p] = m > 0 ? live.reduce((a, s) => a + s.v50[p] * poolMass(s, p) * s.Q, 0) / m : DEFAULT_V50[p];
  }
  return out;
}

/** Scale every particulate pool by its retained fraction (1 − removal). Returns the removed part as a stream-like split. */
export function splitPools(s: Stream, removal: Partial<Record<Pool, number>>): { out: Stream; removed: Stream } {
  const out = cloneStream(s);
  const removed = emptyStream(s.Q);
  removed.pH = s.pH;
  removed.T = s.T;
  const r = (p: Pool) => Math.min(1, Math.max(0, removal[p] ?? 0));
  const take = (p: Pool, apply: (keep: number, rem: number) => void) => apply(1 - r(p), r(p));
  take('grit', (k, x) => ((removed.grit = s.grit * x), (out.grit = s.grit * k)));
  take('inert', (k, x) => ((removed.inert = s.inert * x), (out.inert = s.inert * k)));
  take('colloid', (k, x) => ((removed.colloid = s.colloid * x), (out.colloid = s.colloid * k)));
  take('floc', (k, x) => ((removed.floc = s.floc * x), (out.floc = s.floc * k)));
  take('organic', (k, x) => {
    removed.XS = s.XS * x;
    removed.XI = s.XI * x;
    out.XS = s.XS * k;
    out.XI = s.XI * k;
  });
  take('precipitate', (k, x) => {
    for (const m of METALS) {
      removed.precipitated[m] = s.precipitated[m] * x;
      out.precipitated[m] = s.precipitated[m] * k;
    }
  });
  take('alFloc', (k, x) => ((removed.alSolid = s.alSolid * x), (out.alSolid = s.alSolid * k)));
  take('feFloc', (k, x) => ((removed.feSolid = s.feSolid * x), (out.feSolid = s.feSolid * k)));
  take('biomass', (k, x) => ((removed.biomass = s.biomass * x), (out.biomass = s.biomass * k)));
  return { out, removed };
}
