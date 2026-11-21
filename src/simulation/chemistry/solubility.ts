/**
 * Metal hydroxide solubility and hydrolysis speciation. Ref: knowledge/chemistry/solubility_product.md, precipitation.md
 *
 * Total dissolved metal in equilibrium with M(OH)z(s) (z = 2 for Ni, Cu, Zn; 3 for Cr(III)):
 *   M_T,sol = (Ksp / [OH−]^z) · (1 + Σ β_i [OH−]^i)
 * Mean charge of dissolved metal species: z̄ = Σ α_i (z − i), α_i = β_i[OH]^i / (1 + Σ β_j[OH]^j), β_0 = 1
 */
import { Metal } from '../core/stream';
import { MW, molL_to_mgL } from '../core/units';
import { HYDROXIDES, pKw } from './constants';

/** [OH−] on the 25 °C basis — the hydroxide constants are 25 °C values tied to pKw(25). */
const PKW25 = pKw(25);
function ohConc(pH: number, _T_C: number): number {
  void _T_C;
  return Math.pow(10, pH - PKW25);
}

function hydrolysisTerms(m: Metal, oh: number): number[] {
  const { logBeta } = HYDROXIDES[m];
  const terms = [1];
  for (let i = 0; i < 4; i++) terms.push(Number.isFinite(logBeta[i]) ? Math.pow(10, logBeta[i]) * Math.pow(oh, i + 1) : 0);
  return terms;
}

/** Equilibrium solubility of the metal hydroxide, mol/L total dissolved. */
export function solubilityMolL(m: Metal, pH: number, T_C = 25): number {
  const oh = ohConc(pH, T_C);
  const z = HYDROXIDES[m].z;
  const free = Math.pow(10, HYDROXIDES[m].logKsp) / Math.pow(oh, z);
  const sum = hydrolysisTerms(m, oh).reduce((a, b) => a + b, 0);
  return free * sum;
}

/** Equilibrium solubility, mg/L as metal. */
export function solubilityMgL(m: Metal, pH: number, T_C = 25): number {
  return molL_to_mgL(solubilityMolL(m, pH, T_C), MW[m]);
}

/** Mean ionic charge per mole of dissolved metal at this pH (z = all free M^z+). */
export function meanCharge(m: Metal, pH: number, T_C = 25): number {
  const terms = hydrolysisTerms(m, ohConc(pH, T_C));
  const sum = terms.reduce((a, b) => a + b, 0);
  const z = HYDROXIDES[m].z;
  return terms.reduce((a, t, i) => a + (t / sum) * (z - i), 0);
}

/** pH of minimum solubility (scan 6–13 in 0.01 steps). */
export function minimumSolubilityPH(m: Metal, T_C = 25): { pH: number; mgL: number } {
  let best = { pH: 7, mgL: Infinity };
  for (let pH = 6; pH <= 13; pH += 0.01) {
    const s = solubilityMgL(m, pH, T_C);
    if (s < best.mgL) best = { pH: Math.round(pH * 100) / 100, mgL: s };
  }
  return best;
}

/**
 * Coagulant hydroxides — fresh amorphous Al(OH)3 / Fe(OH)3 floc (25 °C). Ref: knowledge/chemistry/coagulation_flocculation.md
 *   M(OH)3(am) + 3H+ ⇌ M3+ + 3H2O                 log*Ks0
 *   M3+ + nH2O ⇌ M(OH)n^(3−n) + nH+               log*βn
 * so [M(OH)n] = 10^(log*Ks0 + log*βn − (3 − n)·pH).
 * verify: Al(OH)3(am) log*Ks0 10.8, AlOH2+ −4.97, Al(OH)4− −22.9 (Stumm & Morgan 1996; Baes & Mesmer 1976).
 *   Al(OH)2+ and Al(OH)3° are omitted: their published constants scatter by > 1 log unit and, taken at face value,
 *   would put the minimum solubility of fresh floc far above the 0.05–0.2 mg/L residual Al seen after good alum coagulation.
 * verify: Fe(OH)3(am) log*Ks0 3.2, FeOH2+ −2.19, Fe(OH)2+ −5.67, Fe(OH)4− −21.6 (Stumm & Morgan 1996 Table 6.?; Fe(OH)3° negligible).
 */
export type CoagMetal = 'Al' | 'Fe';
export const COAG_HYDROXIDES: Record<CoagMetal, { logKs0: number; logBeta: Partial<Record<1 | 2 | 3 | 4, number>> }> = {
  Al: { logKs0: 10.8, logBeta: { 1: -4.97, 4: -22.9 } },
  Fe: { logKs0: 3.2, logBeta: { 1: -2.19, 2: -5.67, 4: -21.6 } },
};

/** Solubility of the coagulant hydroxide (mol/L total dissolved) and the mean charge of the dissolved species. */
export function coagSolubility(m: CoagMetal, pH: number): { molL: number; zbar: number } {
  const { logKs0, logBeta } = COAG_HYDROXIDES[m];
  let tot = Math.pow(10, logKs0 - 3 * pH);
  let charge = 3 * tot;
  for (const n of [1, 2, 3, 4] as const) {
    const b = logBeta[n];
    if (b === undefined) continue;
    const c = Math.pow(10, logKs0 + b - (3 - n) * pH);
    tot += c;
    charge += (3 - n) * c;
  }
  return { molL: tot, zbar: charge / tot };
}

/** Dissolved coagulant metal (mg/L as metal) in equilibrium at pH, capped at the total present. */
export function coagDissolvedMgL(m: CoagMetal, totalMgL: number, pH: number): number {
  return Math.min(totalMgL, molL_to_mgL(coagSolubility(m, pH).molL, MW[m]));
}
