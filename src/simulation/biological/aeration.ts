/**
 * Aeration air flow and respiration CO2 — feeds the aeration-tank CO2 balance (acidBase.ts aerationCarbonate).
 * Ref: knowledge/chemistry/acid_base_chemistry.md "Aeration CO2 balance", knowledge/biological/activated_sludge.md
 *
 * Air flow (mol/d):  G = max( O2 transferred / (OTE · y_O2 · 32 g/mol),  mixing air · V · ρ_air,mol )
 * CO2 produced (mol/d): P = RQ · (heterotrophic O2 uptake, g/d) / 32 − nitrifier carbon fixation (5 mol C per 113 g VSS)
 *
 * GAME MODEL constants (verify):
 *   OTE 0.10   — field O2 transfer efficiency of fine-bubble diffusers at ≈ 4.5 m (SOTE 25–30 % × α 0.5 × driving force ≈ 0.7)
 *   mixing air 0.012 m³ air/(m³·min) — minimum to keep a full-floor fine-pore grid mixed (≈ 10–15 m³/10³ m³·min, or
 *              ≈ 2.2 m³/m²·h of floor; the Metcalf & Eddy 20–30 m³/10³ m³·min figure is for coarse-bubble spiral roll)
 *   RQ 0.9 mol CO2 per mol O2 — respiratory quotient of mixed industrial organics (carbohydrate 1.0, protein ≈ 0.8, fat ≈ 0.7)
 */
export const AERATION = { OTE: 0.1, yO2: 0.2095, mixingAir_m3m3min: 0.012, RQ: 0.9 };

/** moles of gas per m³ at 1 atm and T °C */
export function gasMolPerM3(T_C: number): number {
  return 101325 / (8.314 * (273.15 + T_C));
}

/** Aeration air flow, mol/d: whichever is larger, the O2 demand or the mixing minimum. */
export function airFlow_mold(o2Transferred_gd: number, volume_m3: number, T_C: number): { air_mold: number; mixingLimited: boolean } {
  const forO2 = airForO2_mold(o2Transferred_gd);
  const forMixing = mixingAir_mold(volume_m3, T_C);
  return { air_mold: Math.max(forO2, forMixing), mixingLimited: forMixing > forO2 };
}

/** Mixing-minimum air flow, mol/d. */
export function mixingAir_mold(volume_m3: number, T_C: number): number {
  return AERATION.mixingAir_m3m3min * 1440 * volume_m3 * gasMolPerM3(T_C);
}

/** Air needed to transfer the O2 demand at the field OTE, mol/d. */
export function airForO2_mold(o2Transferred_gd: number): number {
  return Math.max(0, o2Transferred_gd) / 32 / (AERATION.OTE * AERATION.yO2);
}

/**
 * Respiration CO2 produced, mol/d: heterotrophic O2 uptake × RQ, less CO2 fixed by nitrifier growth.
 * May be negative (nitrifier fixation > heterotrophic CO2, e.g. ammonia condensate): the influent C_T then supplies it.
 */
export function co2Produced_mold(heteroO2_gd: number, nitrifierVSS_gd = 0): number {
  return (AERATION.RQ * Math.max(0, heteroO2_gd)) / 32 - (5 * Math.max(0, nitrifierVSS_gd)) / 113;
}
