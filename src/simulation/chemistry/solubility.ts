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
