/**
 * Unit conversions and physical constants. All simulation conversions go through here.
 * Ref: knowledge/design/design_parameters.md, knowledge/chemistry/chemical_dosing.md
 *
 * Internal conventions:
 *   concentration  mg/L (= g/m³)
 *   flow           m³/d
 *   volume         m³
 *   mass flow      kg/d
 *   temperature    °C
 *   molar (chemistry solvers only) mol/L, eq/L
 */

/** Molar masses, g/mol. Source: IUPAC standard atomic weights (rounded). */
export const MW = {
  H: 1.008,
  O: 15.999,
  N: 14.007,
  Na: 22.99,
  Ca: 40.078,
  S: 32.06,
  Cl: 35.45,
  Al: 26.982,
  Fe: 55.845,
  Ni: 58.693,
  Cu: 63.546,
  Zn: 65.38,
  Cr: 51.996,
  NaOH: 39.997,
  CaOH2: 74.093,
  H2SO4: 98.079,
  CaCO3: 100.087,
  /** Alum, Al2(SO4)3·14H2O */
  alum: 594.4,
  FeCl3: 162.2,
  AlOH3: 78.004,
  FeOH3: 106.867,
  NiOH2: 92.708,
  CuOH2: 97.561,
  ZnOH2: 99.395,
  CrOH3: 103.018,
  /** sodium metabisulfite Na2S2O5 */
  Na2S2O5: 190.1,
  SO4: 96.06,
} as const;

/** Equivalent weight of CaCO3 (g/eq) used for alkalinity "as CaCO3". */
export const EQ_WT_CACO3 = MW.CaCO3 / 2;

/** gCOD per g VSS of biomass (C5H7O2N). Metcalf & Eddy (5th ed.) §7-3. */
export const COD_PER_VSS = 1.42;

/** gN per g VSS of biomass (C5H7O2N: 14/113). */
export const N_PER_VSS = 0.124;

/** mass flow kg/d from flow (m³/d) and concentration (mg/L = g/m³). */
export function kgPerDay(Q_m3d: number, C_mgL: number): number {
  return (Q_m3d * C_mgL) / 1000;
}

/** concentration mg/L from mass flow kg/d and flow m³/d. */
export function mgPerL(massKgD: number, Q_m3d: number): number {
  if (Q_m3d <= 0) return 0;
  return (massKgD * 1000) / Q_m3d;
}

export function mgL_to_molL(mgL: number, mw: number): number {
  return mgL / 1000 / mw;
}

export function molL_to_mgL(molL: number, mw: number): number {
  return molL * mw * 1000;
}

/** eq/L -> mg/L as CaCO3 */
export function eqL_to_mgCaCO3(eqL: number): number {
  return eqL * EQ_WT_CACO3 * 1000;
}

export function mgCaCO3_to_eqL(mgL: number): number {
  return mgL / 1000 / EQ_WT_CACO3;
}

export function celsiusToKelvin(t: number): number {
  return t + 273.15;
}

export function perDayToPerHour(x: number): number {
  return x / 24;
}

/** Hydraulic retention time (d) = V / Q. knowledge/design/design_parameters.md */
export function hrtDays(V_m3: number, Q_m3d: number): number {
  if (Q_m3d <= 0) return Infinity;
  return V_m3 / Q_m3d;
}

/** Surface overflow rate (m/h) = Q / A, with Q in m³/d. knowledge/design/design_parameters.md */
export function surfaceOverflowRate_mh(Q_m3d: number, A_m2: number): number {
  if (A_m2 <= 0) return Infinity;
  return Q_m3d / A_m2 / 24;
}

/** Arrhenius-type temperature correction k_T = k_20 · θ^(T−20). */
export function tempCorrect(k20: number, theta: number, T_C: number): number {
  return k20 * Math.pow(theta, T_C - 20);
}
