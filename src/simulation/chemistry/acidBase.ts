/**
 * Acid-base equilibrium by charge balance. Ref: knowledge/chemistry/acid_base_chemistry.md
 *
 * Charge balance (eq/L):
 *   [H+] + Cb + Σ_m M_diss,m · z̄_m(pH) = [OH−] + [HCO3−] + 2[CO3 2−] + [A−]
 * where Cb = Σ strong cations − Σ strong anions, M_diss = min(M_total, solubility(pH)).
 * Solved for pH by bisection (residual is monotonically decreasing in pH over 0–14).
 *
 * Modes:
 *   closed — C_T conserved (tanks, pipes, chemical reactors)
 *   open   — [H2CO3*] fixed (aerated basins strip CO2 towards a supersaturated equilibrium with air)
 */
import { METALS, Metal, Stream, cloneStream } from '../core/stream';
import { MW, eqL_to_mgCaCO3, mgL_to_molL, molL_to_mgL } from '../core/units';
import { KH_CO2, PKA_HCRO4, PKA_HSO4, P_CO2_ATM, pK1, pK2, pKw } from './constants';
import { meanCharge, solubilityMolL } from './solubility';

export interface CarbonateMode {
  kind: 'closed' | 'open';
  /** open mode: fixed H2CO3* mol/L */
  H2CO3?: number;
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
  if (mode.kind === 'open') {
    const h2co3 = mode.H2CO3 ?? 0;
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

/** H2CO3* in an aerated basin: `supersaturation` × equilibrium with atmospheric CO2. GAME MODEL default 10×. */
export function aeratedH2CO3(T_C: number, supersaturation = 10): number {
  return KH_CO2(T_C) * P_CO2_ATM * supersaturation;
}

/**
 * Re-equilibrate a stream: solve pH, partition metals between dissolved and precipitated
 * (precipitates re-dissolve if under-saturated), update C_T in open mode.
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
  if (mode.kind === 'open') {
    const c = consts(s);
    const H = Math.pow(10, -pH);
    const h = mode.H2CO3 ?? 0;
    out.CT = h * (1 + c.K1 / H + (c.K1 * c.K2) / (H * H));
  }
  return out;
}

/** Strong base (eq/L, positive) or strong acid (negative) needed to bring the stream to targetPH (closed system). */
export function baseDemand(s: Stream, targetPH: number): number {
  return requiredCb(s, targetPH) - s.Cb;
}

/** Total alkalinity: acid needed to titrate to pH 4.5, mg/L as CaCO3. */
export function alkalinity(s: Stream): number {
  return Math.max(0, eqL_to_mgCaCO3(s.Cb - requiredCb(s, 4.5)));
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
