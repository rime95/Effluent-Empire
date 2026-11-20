/**
 * Equilibrium constants. Ref: knowledge/chemistry/acid_base_chemistry.md, knowledge/chemistry/solubility_product.md
 * Activity corrections are neglected (ideal solution, I → 0). GAME MODEL simplification, documented.
 */
import { Metal } from '../core/stream';
import { celsiusToKelvin } from '../core/units';

/** pKw(T). Harned & Owen regression: pKw = 4470.99/T − 6.0875 + 0.01706·T (T in K). 25 °C → 13.995 */
export function pKw(T_C: number): number {
  const T = celsiusToKelvin(T_C);
  return 4470.99 / T - 6.0875 + 0.01706 * T;
}

/** pK1 of carbonic acid (H2CO3* ⇌ H+ + HCO3−). Harned & Davis: 3404.71/T − 14.8435 + 0.032786·T. 25 °C → 6.35 */
export function pK1(T_C: number): number {
  const T = celsiusToKelvin(T_C);
  return 3404.71 / T - 14.8435 + 0.032786 * T;
}

/** pK2 of carbonic acid (HCO3− ⇌ H+ + CO3 2−). Harned & Scholes: 2902.39/T − 6.498 + 0.02379·T. 25 °C → 10.33 */
export function pK2(T_C: number): number {
  const T = celsiusToKelvin(T_C);
  return 2902.39 / T - 6.498 + 0.02379 * T;
}

/** Henry constant for CO2, mol/(L·atm). log KH = 108.3865 + 0.01985076·T − 6919.53/T − 40.45154·log T + 669365/T² (Plummer & Busenberg 1982). 25 °C → 10^−1.47 */
export function KH_CO2(T_C: number): number {
  const T = celsiusToKelvin(T_C);
  const logKH = 108.3865 + 0.01985076 * T - 6919.53 / T - 40.45154 * Math.log10(T) + 669365 / (T * T);
  return Math.pow(10, logKH);
}

/** Atmospheric CO2 partial pressure, atm (~420 ppm, 2025). */
export const P_CO2_ATM = 420e-6;

/**
 * Metal hydroxide solubility data at 25 °C. Solubility is evaluated with [OH−] from pKw(25 °C), i.e. on the H+ basis
 * (*Ks0 = Ksp/Kw²), so temperature dependence is genuinely neglected (not introduced through pKw(T)).
 *   Ksp:  M(OH)2(s) ⇌ M2+ + 2OH−      log Ksp
 *   β_i:  M2+ + i OH− ⇌ M(OH)_i^(2−i)  log β_i (cumulative, OH− basis; = log*β_i + i·pKw)
 * Verified 2026-11-21 against IUPAC (Cu, Zn) and NEA (Ni hydrolysis) critical reviews — see knowledge/VERIFICATION.md;
 * fresh (amorphous) precipitates chosen as most representative of wastewater treatment.
 */
export interface HydroxideData {
  /** cation charge (2 for M(OH)2, 3 for M(OH)3) */
  z: number;
  /** M(OH)z(s) ⇌ M^z+ + z OH− */
  logKsp: number;
  logBeta: [number, number, number, number];
}

export const HYDROXIDES: Record<Metal, HydroxideData> = {
  // Ni: hydrolysis from the NEA review (Gamsjäger et al. 2005): NiOH+ log*β1 −9.54 ± 0.14; Ni(OH)3− log*β3 −29.2 ± 1.7;
  // Ni(OH)2(aq) NOT selected by NEA (omitted). Solid: freshly precipitated Ni(OH)2 log Ksp −15.2 (log*Ks0 12.8) — GAME choice,
  // unverified against a primary source; crystalline β-Ni(OH)2 (NEA) is log*Ks0 11.03 ± 0.28 (log Ksp −16.97), ~60× less soluble.
  Ni: { z: 2, logKsp: -15.2, logBeta: [4.46, -Infinity, 12.8, -Infinity] },
  // Cu — IUPAC (Powell et al. 2007, Pure Appl. Chem. 79:895): CuOH+ −7.95; Cu(OH)2(aq) −16.2; Cu(OH)3− −26.60; Cu(OH)4 2− −39.74 (log*β);
  // Cu(OH)2(s) log*Ks0 ≈ 8.67 → log Ksp −19.33
  Cu: { z: 2, logKsp: -19.33, logBeta: [6.05, 11.8, 15.4, 16.26] },
  // ε-Zn(OH)2 (crystalline) — IUPAC (Powell et al. 2013): log*Ks0 11.38 -> log Ksp −16.62; ZnOH+ −8.96; Zn(OH)2(aq) −17.82; Zn(OH)3− −28.05; Zn(OH)4 2− −40.41 (log*β)
  Zn: { z: 2, logKsp: -16.62, logBeta: [5.04, 10.18, 13.95, 15.59] },
  // Cr(III): Rai, Sass & Moore (1987) Inorg. Chem. 26:345. Cr(OH)3(am) log*Ks0 9.76 (✅ ECHA dossier) → log Ksp = 9.76 − 42 = −32.24;
  // CrOH2+ log*β1 −3.57 ✅, Cr(OH)2+ −9.84 ✅, Cr(OH)3(aq) −16.19 🔴, Cr(OH)4− −27.65 🔴 (see knowledge/VERIFICATION.md)
  Cr: { z: 3, logKsp: -32.24, logBeta: [10.43, 18.16, 25.81, 28.35] },
};

/** HCrO4− ⇌ H+ + CrO4 2−, pKa 6.51 (25 °C). Dichromate dimerisation neglected: log K(2HCrO4− ⇌ Cr2O7 2− + H2O) = 1.52 → dimer < 5 % below ~1 mM (~50 mg/L Cr); charge per Cr unchanged below pH 5. */
export const PKA_HCRO4 = 6.51;

/** HSO4− ⇌ H+ + SO4 2−, pKa2 1.99 at 25 °C, I → 0 (Martell & Smith, Critical Stability Constants). Temperature dependence neglected. */
export const PKA_HSO4 = 1.99;
