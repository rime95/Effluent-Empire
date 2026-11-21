/**
 * Acid-base equilibrium by charge balance. Ref: knowledge/chemistry/acid_base_chemistry.md
 *
 * Charge balance (eq/L):
 *   [H+] + Cb + Σ_m M_diss,m · z̄_m(pH) = [OH−] + [HCO3−] + 2[CO3 2−] + [A−]
 * where Cb = Σ strong cations − Σ strong anions, M_diss = min(M_total, solubility(pH)).
 * Solved for pH by bisection (residual is monotonically decreasing in pH over 0–14).
 *
 * Modes:
 *   closed   — C_T conserved (tanks, pipes, chemical reactors)
 *   open     — [H2CO3*] fixed (equilibrium with a known gas phase)
 *   stripped — aerated reactor: steady-state CO2 balance between liquid in/out, CO2 produced and the aeration air
 *              (see aerationCarbonate)
 */
import { METALS, Metal, Stream, cloneStream } from '../core/stream';
import { MW, eqL_to_mgCaCO3, mgL_to_molL, molL_to_mgL } from '../core/units';
import { KH_CO2, PKA_HCRO4, PKA_HSO4, P_CO2_ATM, pK1, pK2, pKw } from './constants';
import { coagDissolvedMgL, coagSolubility, meanCharge, solubilityMolL } from './solubility';

export interface CarbonateMode {
  kind: 'closed' | 'open' | 'stripped';
  /** open mode: fixed H2CO3* mol/L */
  H2CO3?: number;
  /** stripped mode: inorganic carbon supplied, mol/d (liquid C_T in + CO2 produced + CO2 in the inlet air) */
  carbonIn_mold?: number;
  /** stripped mode: liquid flow, L/d */
  liquid_Ld?: number;
  /** stripped mode: air flow / K_H, L/d (off-gas in equilibrium with the liquid: y_CO2·P = [H2CO3*]/K_H) */
  gas_Ld?: number;
}

/**
 * Aeration-tank CO2 balance (steady state, completely mixed). Ref: knowledge/chemistry/acid_base_chemistry.md
 *   Q·C_T,in + P_CO2 + G·y_atm = Q·C_T,out + G·y_out,  y_out·P = [H2CO3*]/K_H,  C_T,out = [H2CO3*]·α(pH)
 *   ⇒ [H2CO3*] = (Q·C_T,in + P_CO2 + G·y_atm) / (Q·α(pH) + G/K_H),  α = 1 + K1/[H+] + K1K2/[H+]²
 * GAME MODEL: off-gas leaves in equilibrium with the mixed liquor (deep diffused aeration; CO2 is ~30× more soluble
 * than O2, so its bubbles approach equilibrium well before O2 does), P = 1 atm.
 */
export function aerationCarbonate(p: { Q_m3d: number; CTin: number; T: number; co2Produced_mold: number; air_mold: number }): CarbonateMode {
  const kh = KH_CO2(p.T);
  return {
    kind: 'stripped',
    // net production may be negative (nitrifier CO2 fixation); only the total supply is bounded at zero
    carbonIn_mold: Math.max(0, p.Q_m3d * 1000 * p.CTin + p.co2Produced_mold + p.air_mold * P_CO2_ATM),
    liquid_Ld: p.Q_m3d * 1000,
    gas_Ld: p.air_mold / kh,
  };
}

/** [H2CO3*] at pH in a stripped (aerated) reactor */
function strippedH2CO3(H: number, c: { K1: number; K2: number }, mode: CarbonateMode): number {
  const alpha = 1 + c.K1 / H + (c.K1 * c.K2) / (H * H);
  const den = (mode.liquid_Ld ?? 0) * alpha + (mode.gas_Ld ?? 0);
  return den > 0 ? (mode.carbonIn_mold ?? 0) / den : 0;
}

interface Consts {
  Kw: number;
  K1: number;
  K2: number;
  Ka: number;
}

function consts(s: Stream): Consts {
  return {
    Kw: Math.pow(10, -pKw(s.T)),
    K1: Math.pow(10, -pK1(s.T)),
    K2: Math.pow(10, -pK2(s.T)),
    Ka: Math.pow(10, -s.weakAcidPKa),
  };
}

/** Total metal (mol/L) per metal */
function metalTotalsMol(s: Stream): Record<Metal, number> {
  const r = {} as Record<Metal, number>;
  for (const m of METALS) r[m] = mgL_to_molL(s.dissolved[m] + s.precipitated[m], MW[m]);
  return r;
}

/** Carbonate alkalinity contribution [HCO3−] + 2[CO3 2−], eq/L */
function carbonateCharge(H: number, c: Consts, s: Stream, mode: CarbonateMode): number {
  if (mode.kind === 'open' || mode.kind === 'stripped') {
    const h2co3 = mode.kind === 'open' ? (mode.H2CO3 ?? 0) : strippedH2CO3(H, c, mode);
    return (c.K1 * h2co3) / H + (2 * c.K1 * c.K2 * h2co3) / (H * H);
  }
  const D = H * H + c.K1 * H + c.K1 * c.K2;
  return (s.CT * (c.K1 * H + 2 * c.K1 * c.K2)) / D;
}

/**
 * Strong-base equivalents (eq/L) the solution must contain for pH to equal `pH`
 * (i.e. the Cb that satisfies charge balance at that pH).
 */
export function requiredCb(s: Stream, pH: number, mode: CarbonateMode = { kind: 'closed' }, totals = metalTotalsMol(s)): number {
  const c = consts(s);
  const H = Math.pow(10, -pH);
  const OH = c.Kw / H;
  const A = (s.weakAcidT * c.Ka) / (c.Ka + H);
  // chromate: HCrO4− (−1) ⇌ CrO4 2− (−2)
  const crT = mgL_to_molL(s.CrVI ?? 0, MW.Cr);
  const kCr = Math.pow(10, -PKA_HCRO4);
  const chromate = crT * (1 + kCr / (kCr + H));
  // sulfate: HSO4− (−1) ⇌ SO4 2− (−2)
  const kS = Math.pow(10, -PKA_HSO4);
  const sulfate = (s.SO4T ?? 0) * (1 + kS / (kS + H));
  let metalCharge = 0;
  for (const m of METALS) {
    const diss = Math.min(totals[m], solubilityMolL(m, pH, s.T));
    metalCharge += diss * meanCharge(m, pH, s.T);
  }
  // coagulant Al / Fe: dissolved share of the total in equilibrium with fresh M(OH)3(am)
  const alT = mgL_to_molL(s.alSolid + s.alDissolved, MW.Al);
  const feT = mgL_to_molL(s.feSolid + (s.feDissolved ?? 0), MW.Fe);
  if (alT > 0) {
    const a = coagSolubility('Al', pH);
    metalCharge += Math.min(alT, a.molL) * a.zbar;
  }
  if (feT > 0) {
    const f = coagSolubility('Fe', pH);
    metalCharge += Math.min(feT, f.molL) * f.zbar;
  }
  return OH + carbonateCharge(H, c, s, mode) + A + chromate + sulfate - H - metalCharge;
}

/** Solve pH from charge balance. */
export function solvePH(s: Stream, mode: CarbonateMode = { kind: 'closed' }): number {
  const totals = metalTotalsMol(s);
  // residual(pH) = Cb − requiredCb(pH): positive → solution more basic than pH guess
  let lo = 0;
  let hi = 14;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const r = s.Cb - requiredCb(s, mid, mode, totals);
    if (r > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}


/**
 * Re-equilibrate a stream: solve pH, partition metals between dissolved and precipitated
 * (precipitates re-dissolve if under-saturated), update C_T in open / stripped mode.
 */
export function equilibrate(s: Stream, mode: CarbonateMode = { kind: 'closed' }): Stream {
  const out = cloneStream(s);
  const pH = solvePH(out, mode);
  out.pH = pH;
  for (const m of METALS) {
    const total = s.dissolved[m] + s.precipitated[m];
    const sol = molL_to_mgL(solubilityMolL(m, pH, s.T), MW[m]);
    out.dissolved[m] = Math.min(total, sol);
    out.precipitated[m] = total - out.dissolved[m];
  }
  const alT = s.alSolid + s.alDissolved;
  out.alDissolved = coagDissolvedMgL('Al', alT, pH);
  out.alSolid = alT - out.alDissolved;
  const feT = s.feSolid + (s.feDissolved ?? 0);
  out.feDissolved = coagDissolvedMgL('Fe', feT, pH);
  out.feSolid = feT - out.feDissolved;
  if (mode.kind === 'open' || mode.kind === 'stripped') {
    const c = consts(s);
    const H = Math.pow(10, -pH);
    const h = mode.kind === 'open' ? (mode.H2CO3 ?? 0) : strippedH2CO3(H, c, mode);
    out.CT = h * (1 + c.K1 / H + (c.K1 * c.K2) / (H * H));
  }
  return out;
}

/** Strong base (eq/L, positive) or strong acid (negative) needed to bring the stream to targetPH (closed system). */
export function baseDemand(s: Stream, targetPH: number): number {
  return requiredCb(s, targetPH) - s.Cb;
}

/** Total alkalinity: acid needed to titrate the whole sample (solids included, Standard Methods 2320 B) to pH 4.5, mg/L as CaCO3. */
export function alkalinity(s: Stream): number {
  return Math.max(0, eqL_to_mgCaCO3(s.Cb - requiredCb(s, 4.5)));
}

/**
 * Alkalinity of the solution phase only (filtered sample). Hydroxide solids are excluded: fresh Al(OH)3 / metal
 * hydroxide floc would otherwise dissolve on paper at pH 4.5 and be counted. Removing neutral solids leaves Cb unchanged.
 */
export function alkalinityFiltered(s: Stream): number {
  const f = cloneStream(s);
  for (const m of METALS) f.precipitated[m] = 0;
  f.alSolid = 0;
  f.feSolid = 0;
  return Math.max(0, eqL_to_mgCaCO3(f.Cb - requiredCb(f, 4.5)));
}

/** Acidity: base needed to titrate to pH 8.3, mg/L as CaCO3. */
export function acidity(s: Stream): number {
  return Math.max(0, eqL_to_mgCaCO3(requiredCb(s, 8.3) - s.Cb));
}

/**
 * Initialise Cb for a raw wastewater so that it has the measured pH (back-calculation from a lab pH reading).
 * Metals are assumed fully dissolved at the raw pH if under-saturated.
 */
export function setCbForPH(s: Stream, pH: number): Stream {
  const out = cloneStream(s);
  out.Cb = requiredCb(out, pH);
  return equilibrate(out);
}

/** Titration curve: pH after adding strong base (positive eq/L) or acid (negative). */
export function titrationCurve(s: Stream, doses_eqL: number[]): { dose: number; pH: number }[] {
  return doses_eqL.map((d) => {
    const t = cloneStream(s);
    t.Cb += d;
    return { dose: d, pH: solvePH(t) };
  });
}

/** Buffer intensity β = dCb/dpH (eq/L per pH unit), numerical. */
export function bufferIntensity(s: Stream, pH = s.pH): number {
  const d = 0.01;
  return (requiredCb(s, pH + d) - requiredCb(s, pH - d)) / (2 * d);
}

/**
 * Sulphuric acid needed to bring the stream to targetPH, mol H2SO4/L. H2SO4 adds sulfate (not a strong-ion change);
 * because HSO4− re-associates below pH ≈ 3 the dose is NOT simply ΔCb/2 — solved by bisection on the dose.
 */
export function sulfuricAcidDose(s: Stream, targetPH: number): number {
  const pHWith = (x: number) => solvePH({ ...s, SO4T: (s.SO4T ?? 0) + x });
  if (pHWith(0) <= targetPH) return 0;
  let hi = 1e-4;
  while (pHWith(hi) > targetPH && hi < 10) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pHWith(mid) > targetPH) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export type PHReagent = 'NaOH' | 'lime' | 'H2SO4';

/**
 * Dose alkali (strong-ion change, eq/mol: NaOH 1, lime 2) or sulphuric acid (sulfate addition) to reach targetPH.
 * Returns the dosed (not yet equilibrated) stream and the reagent amount in mol/L.
 */
export function adjustPH(s: Stream, targetPH: number, base: 'NaOH' | 'lime' = 'NaOH'): { stream: Stream; reagent: PHReagent; mol: number; demandEq: number } {
  const demand = baseDemand(s, targetPH);
  const t = cloneStream(s);
  if (demand >= 0) {
    t.Cb += demand;
    return { stream: t, reagent: base, mol: demand / (base === 'lime' ? 2 : 1), demandEq: demand };
  }
  const mol = sulfuricAcidDose(s, targetPH);
  t.SO4T = (t.SO4T ?? 0) + mol;
  return { stream: t, reagent: 'H2SO4', mol, demandEq: demand };
}
