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

## Aerated basins (open system)
Aeration strips CO₂: [H₂CO₃*] = s·K_H·p_CO₂, with p_CO₂ = 420 µatm and supersaturation s = 10. This is a GAME MODEL; aeration basins typically run 3–20× supersaturated. Without it, CO₂ from COD oxidation would accumulate and depress the pH unrealistically.

## Activated-sludge pH self-consistency
Nitrification consumes alkalinity, and VFA oxidation generates it, so reactor pH and biological activity are coupled. The reactor pH is the root of g(pH*) = pH_computed(pH*) − pH*. A healthy and a "soured" root can coexist. A commissioned plant is seeded, so the **highest** root is taken (downward scan, then bisection). With low alkalinity this gives partial nitrification at pH ≈ 6, as real plants show.

## Assumptions and limits
- Ideal solution (I → 0). Above ionic strength 0.1 M (brines, ZLD concentrate) errors exceed about 0.1 pH unit. Davies activity corrections are planned for later phases.
- NH₄⁺ is treated as a strong cation (pKa 9.25), valid below pH ≈ 8.5.
- Metal hydroxo complexes are included through z̄. Sulfate and chloride complexes are neglected.

## Worked examples (`tests/simulation/acidBase.test.ts`)
1. Pure water at 25 °C → pH = pKw/2 = 7.00.
2. 1 mM strong acid (Cb = −1e-3) → [H⁺] ≈ 1e-3 → pH 3.00.
3. 1 mM strong base → pH = pKw − 3 = 10.995.
4. 2 mM NaHCO₃ (Cb = C_T = 2 mM) → pH ≈ (pK₁ + pK₂)/2 ≈ 8.34; alkalinity ≈ 2 meq/L = 100 mg/L as CaCO₃.
5. At pH 4, C_T 0.5 mM vs 5 mM: the buffered sample needs more than 2× the NaOH to reach pH 9.
