# Chromium: Cr(VI) Reduction and Cr(III) Precipitation

Modules: `src/simulation/chemistry/chromiumReduction.ts`, Cr data in `constants.ts`, chromate term in `acidBase.ts`.

## Why a separate step
Hexavalent chromium exists as the **anions** HCrO₄⁻ and CrO₄²⁻ (pKa 6.51). It does not form a hydroxide precipitate at any pH. Hydroxide precipitation alone passes Cr(VI) straight through, which is the classic chrome-plating design error. Cr(VI) must first be reduced to Cr³⁺, which then precipitates as Cr(OH)₃ near pH 8.

## Reduction with sodium metabisulfite
Na₂S₂O₅ + H₂O → 2 NaHSO₃

    HCrO₄⁻ + 3/2 HSO₃⁻ + 5/2 H⁺ → Cr³⁺ + 3/2 SO₄²⁻ + 5/2 H₂O     (balanced: charge, O, H)

- **Stoichiometric demand:** 0.75 mol Na₂S₂O₅ per mol Cr, i.e. **2.74 mg Na₂S₂O₅ per mg Cr(VI)** (tested). Practice: about 2.8 lb per lb Cr(VI), plus about 1.5 lb H₂SO₄ (Products Finishing, "Chrome Reduction"). ✅
- **Practice:** pH 2–2.5, 15–20 min retention, ORP ≈ +250–280 mV endpoint (published dechromatation optimisation; Hanford report). ✅

**Charge-balance bookkeeping** (pH is re-solved, never assumed):
- Chromate leaves the anion side of the charge balance.
- Cr³⁺ enters as dissolved Cr(III), counted through its mean hydrolysis charge.
- Each mol Na₂S₂O₅ adds 2 Na⁺ and ends as 2 SO₄²⁻, so ΔCb = −2 per mol. Excess reductant is assumed to be air-oxidised.

**Kinetics (GAME MODEL):** first order in Cr(VI), strongly acid-catalysed: k = 1.5·10^−(pH − 2) min⁻¹.

| pH | t½ |
|---|---|
| 2 | 0.5 min |
| 2.5 | 1.5 min |
| 3 | 4.6 min |
| 4 | 46 min |
| 5 | 8 h |

This is calibrated so design practice (pH 2.5, 20 min) gives > 99.9 % reduction. Reduction is also capped by reductant supply (dose factor < 1 leaves Cr(VI)).

**pH control:** the reactor pH is held at the set-point. Acid is dosed to the final state, after the reduction has consumed 2.5 H⁺ per Cr, and the rate is evaluated at the set-point. This followed the chemistry review; previously the pH drifted to about 2.7.

**Bisulfate (resolved):** sulfate is now tracked with the HSO₄⁻ equilibrium (pKa₂ 1.99). The acid dose to pH 2–2.5 is solved exactly and is 14–33 % higher than the old strong-anion estimate. See `acid_base_chemistry.md` §Sulfate.

**Design lesson:** the reactor must be sized at **peak** flow, so place it after equalisation. A reference design that put it first lost about 8 % of the Cr(VI) at a peak factor of 2.5.

## Cr(III) hydroxide
Rai, Sass & Moore (1987) *Inorg. Chem.* 26:345:

| Constant | Value | Status |
|---|---|---|
| Cr(OH)₃(am) log*Ks0 | 9.76 (log Ksp −32.24) | ✅ ECHA registration dossier |
| CrOH²⁺ log*β₁ | −3.57 | ✅ |
| Cr(OH)₂⁺ log*β₂ | −9.84 (pK₂ 6.27) | ✅ |
| Cr(OH)₃(aq) log*β₃ | −16.19 | 🔴 |
| Cr(OH)₄⁻ log*β₄ | −27.65 | 🔴 |

The model's Cr(OH)₃ solubility minimum falls between pH 7 and 10 (tested). The trivalent charge (z = 3) is handled by the general hydroxide solubility code.

## Limits (P.U.(A) 434/2009, Fifth Schedule) ✅
- Chromium, hexavalent: 0.05 / 0.05 mg/L
- Chromium, trivalent: 0.20 / 1.0 mg/L

Chromium is not one of the Regulation 11(2) combined metals.
