# Acid–Base Chemistry

Module: `src/simulation/chemistry/acidBase.ts`, constants in `constants.ts`.

## Governing equations
Charge balance (eq/L), ideal solution (activity coefficients = 1):

    [H⁺] + Cb + Σ_m M_diss,m·z̄_m = [OH⁻] + [HCO₃⁻] + 2[CO₃²⁻] + [A⁻] + [HCrO₄⁻] + 2[CrO₄²⁻] + [HSO₄⁻] + 2[SO₄²⁻]

- **Carbonate, closed system (C_T conserved):** [HCO₃⁻] + 2[CO₃²⁻] = C_T (K₁[H⁺] + 2K₁K₂) / ([H⁺]² + K₁[H⁺] + K₁K₂)
- **Carbonate, open/aerated:** [H₂CO₃*] is fixed, so [HCO₃⁻] = K₁[H₂CO₃*]/[H⁺] and [CO₃²⁻] = K₁K₂[H₂CO₃*]/[H⁺]²
- **Weak acid:** [A⁻] = A_T·Ka / (Ka + [H⁺])
- **Dissolved metals** contribute their mean hydrolysis charge z̄ (see `solubility_product.md`), with M_diss = min(M_total, solubility(pH)).
- Kw = [H⁺][OH⁻]

The residual Cb − requiredCb(pH) decreases monotonically with pH. It is solved by bisection on pH ∈ [0, 14] with 80 iterations.

## Sulfate (added after the chemistry review)
Sulfate is a **tracked species** (`SO4T`, mol/L). It is not folded into Cb, because HSO₄⁻ ⇌ H⁺ + SO₄²⁻ has **pKa₂ = 1.99** (Martell & Smith). Below pH ≈ 3 a large share of sulfate re-associates and takes back protons, so a strong-anion treatment under-doses acid in exactly the Cr(VI) reduction window.

- [HSO₄⁻] + 2[SO₄²⁻] = SO4T · (1 + α₂), with α₂ = Ka₂/(Ka₂ + [H⁺]).
- **H₂SO₄** adds sulfate. Its dose to a target pH is solved by bisection (`sulfuricAcidDose`), not taken as ΔCb/2.
- **Alum** adds 3 SO₄ per mol (Al precipitates). **Metabisulfite** adds 2 Na⁺ to Cb and 2 SO₄ to SO4T. FeCl₃ and PAC add chloride, a strong anion, and stay as ΔCb.
- Industry background sulfate (mmol/L): plating 3–12, food 0.5–2, semiconductor 1–6. The titration + IC lab test reports it.
- Sulfate is a mass-balance component.
- **Saves from before this change** have no SO4T (treated as 0): their sulfate stays inside Cb as before.

Worked examples (ideal solution, tested):
- 1 mM H₂SO₄ → pH 2.73 (fully dissociated: 2.70).
- 10 mM → pH 1.85 (fully dissociated: 1.70; measured ≈ 1.96 because of activity effects, which the model neglects).
- In a weakly buffered water, H₂SO₄ demand is **+33 %** above the strong-acid model to reach pH 2, **+14 %** to pH 2.5, and negligible at pH 4.

## Constants (temperature-dependent, T in K)
| Constant | Expression | 25 °C | Source |
|---|---|---|---|
| pKw | 4470.99/T − 6.0875 + 0.01706·T | 13.995 | Harned & Owen |
| pK₁ | 3404.71/T − 14.8435 + 0.032786·T | 6.35 | Harned & Davis |
| pK₂ | 2902.39/T − 6.498 + 0.02379·T | 10.33 | Harned & Scholes |
| log K_H(CO₂) | 108.3865 + 0.01985076T − 6919.53/T − 40.45154 log T + 669365/T² | −1.47 | Plummer & Busenberg (1982) |
| VFA pKa | 4.76 (acetic acid) | | |

verify: regression coefficients as commonly reproduced in Stumm & Morgan, *Aquatic Chemistry* (3rd ed.).

## Derived quantities
- **Strong-base demand to a target pH:** ΔCb = requiredCb(pH_target) − Cb. This is the titration, and it includes base consumed by metal hydroxide precipitation. **Two waters at the same pH with different C_T need different doses.**
- **Alkalinity** (to a fixed pH 4.5) = Cb − requiredCb(4.5), reported as mg/L CaCO₃ (× 50 040 mg/eq). The true equivalence point moves with C_T (about 4.3–4.9, Standard Methods 2320). Precipitated hydroxides re-dissolve during the titration and VFAs are about 36 % dissociated at pH 4.5, so both count, as they would in an unfiltered sample.
- **Acidity** (to pH 8.3) = requiredCb(8.3) − Cb.
- **Buffer intensity** β = dCb/dpH (numerical).
- **Raw wastewater initialisation:** Cb is back-calculated from charge balance using the measured pH.

## Aeration CO₂ balance (stripped mode, since 2026-11-21)
Code: `acidBase.ts` `aerationCarbonate` (carbonate mode `stripped`), `biological/aeration.ts`. Used by the steady-state activated sludge and by the dynamic ASM1 reactor.

The earlier fixed assumption is removed. It held [H₂CO₃*] at 10× air saturation whatever the load or air flow. A lightly loaded, poorly buffered basin was therefore too acidic: semiconductor rinse water neutralised to pH 7.5 came out at pH 6.4 with no nitrification at all. The reactor CO₂ is now a steady-state balance on the completely mixed tank:

  Q·C_T,in + P_CO₂ + G·y_atm = Q·C_T,out + G·y_out
  y_out·P = [H₂CO₃*]/K_H  (off-gas in equilibrium with the mixed liquor)
  ⇒ [H₂CO₃*] = (Q·C_T,in + P_CO₂ + G·y_atm) / (Q·α(pH) + G/K_H),  α = 1 + K₁/[H⁺] + K₁K₂/[H⁺]²

- **P_CO₂ (mol/d)** = RQ × heterotrophic O₂ uptake / 32, minus the CO₂ fixed by nitrifier growth (5 mol C per 113 g VSS).
  - Nitrification itself releases no CO₂; its acid converts HCO₃⁻ to CO₂ inside C_T through the charge balance.
  - The dynamic model (ASM1) uses RQ·(1 − Y_H)/Y_H·(ρ₁ + ρ₂)·V/32 for aerobic and anoxic heterotroph growth, minus ρ₃·V/32 (32 g COD per mol C of C₅H₇NO₂).
  - Net production may be negative, for example ammonia condensate. Then only the total carbon supply is bounded at zero, so no carbon is created.
- **G (mol air/d)** = max(O₂ transferred / (OTE · 0.2095 · 32), mixing air · V).
  - In the dynamic replay, air follows the blower: design air × kLa/kLa_design.
  - The mixing floor applies only while the blower runs, so a tripped blower strips nothing.
- 🟡 verify, all GAME MODEL:
  - RQ = 0.9 mol CO₂/mol O₂ (carbohydrate 1.0, protein ≈ 0.8, fat ≈ 0.7);
  - field OTE = 0.10 (fine bubble at ≈ 4.5 m: SOTE 25–30 % × α 0.5 × driving force ≈ 0.7);
  - mixing minimum 0.012 m³ air/(m³·min) for a full-floor fine-pore grid (≈ 10–15 m³/10³ m³·min, or ≈ 2.2 m³/m²·h of floor). The Metcalf & Eddy 20–30 m³/10³ m³·min figure is for coarse-bubble spiral roll;
  - P = 1 atm, and full off-gas equilibration. Real off-gas reaches perhaps 50–90 % of equilibrium, so this slightly under-predicts the CO₂; deep tanks with high OTE run closer to equilibrium.
- The residual is still monotonic in pH: the carbonate charge [H₂CO₃*](K₁/H + 2K₁K₂/H²) rises with pH. Bisection therefore still applies, and the reactor pH self-consistency loop is unchanged.
- **Consequences**, now load- and flow-dependent as in practice:
  - **O₂-limited basins:** air scales with the O₂ demand. The CO₂ to air ratio is therefore fixed at RQ·OTE·y_O₂ ≈ 1.9 % v/v, and dissolved CO₂ approaches K_H × 0.019 atm ≈ 25 mg/L at 30 °C, whatever the flow or tank size. A high-strength food basin runs pH 6.5–7 for this reason.
  - The real design lever is OTE: deep tanks and high-efficiency diffusers give more CO₂ and a lower pH, while surface aerators or coarse bubble give less.
  - Flow and tank size act only through the mixing floor, and through HRT/SRT effects on the biology.
  - A lightly loaded basin runs on the mixing-air minimum, strips almost to air equilibrium (a few mg/L CO₂) and drifts up.
  - Stripping does not change alkalinity; only nitrification, NH₄⁺ uptake, VFA oxidation and dosing do.
- The tank inspector shows the air flow (and whether it is O₂- or mixing-limited), the dissolved CO₂ and the off-gas CO₂ % v/v.
- Not yet modelled:
  - RQ weighted by substrate class (acetate and carbohydrate 1.0, lipids ≈ 0.7);
  - inorganic carbon as a mass-balance component (`Components` has no C, so the off-gas CO₂ flux is reported in calcs only).
- Tests: `tests/simulation/aerationCO2.test.ts` covers air equilibrium, closed limit, carbon closure, air flow, the O₂-limited CO₂ ceiling, the mixing floor and negative net production. Reviewed 2026-11-21 by `biological-engineer`, whose findings are applied.

## Activated-sludge pH self-consistency
Nitrification consumes alkalinity, and VFA oxidation generates it, so reactor pH and biological activity are coupled. The reactor pH is the root of g(pH*) = pH_computed(pH*) − pH*. A healthy and a "soured" root can coexist. A commissioned plant is seeded, so the **highest** root is taken (downward scan, then bisection). With low alkalinity this gives partial nitrification at pH ≈ 6, as real plants show.

## Assumptions and limits
- Ideal solution (I → 0). Above ionic strength 0.1 M (brines, ZLD concentrate) errors exceed about 0.1 pH unit. Davies activity corrections are planned for later phases.
- **Ammonia** (since 2026-11-21, chem 2) is a weak base in the charge balance. `NH4N` is total ammonia N, and its NH₄⁺ share is N_T·[H⁺]/([H⁺] + K_a), with pKa = 0.09018 + 2729.92/T (Emerson et al. 1975): 9.25 at 25 °C, 9.09 at 30 °C. Cb excludes ammonia; NO₃⁻ stays in Cb as a strong anion.
  - Below pH 8.5 nothing changes: nitrification still consumes 7.14 mg CaCO₃/mg N, and assimilation 3.57.
  - At high pH, NH₃ is alkalinity. Nitrification starting from NH₃ releases 1 H⁺ per N, not 2, and assimilating NH₃ releases none.
  - The earlier strong-cation treatment over-predicted the pH crash in aeration tanks fed above pH 9: pH 10.5 feed fell to 5.9 after nitrifying only 6 mg/L N.
  - Old saves are migrated (`store.ts` `migrateAmmoniaCb`: Cb −= NH4N/14 007, so the pH is unchanged).
  - NH₃ stripping by aeration at high pH is not yet modelled.
- Metal hydroxo complexes are included through z̄. Sulfate and chloride complexes are neglected.

## Worked examples (`tests/simulation/acidBase.test.ts`)
1. Pure water at 25 °C → pH = pKw/2 = 7.00.
2. 1 mM strong acid (Cb = −1e-3) → [H⁺] ≈ 1e-3 → pH 3.00.
3. 1 mM strong base → pH = pKw − 3 = 10.995.
4. 2 mM NaHCO₃ (Cb = C_T = 2 mM) → pH ≈ (pK₁ + pK₂)/2 ≈ 8.34; alkalinity ≈ 2 meq/L = 100 mg/L as CaCO₃.
5. At pH 4, C_T 0.5 mM vs 5 mM: the buffered sample needs more than 2× the NaOH to reach pH 9.
