# Solubility Products and Metal Hydrolysis

Module: `src/simulation/chemistry/solubility.ts`, data in `constants.ts` (`HYDROXIDES`).

## Governing equations
For M(OH)₂(s) ⇌ M²⁺ + 2OH⁻, K_sp = [M²⁺][OH⁻]².
Hydrolysis complexes form as M²⁺ + iOH⁻ ⇌ M(OH)ᵢ^(2−i), with cumulative constants βᵢ on an OH⁻ basis (log βᵢ = log *βᵢ + i·pKw).

    M_T,sol(pH) = (K_sp/[OH⁻]²) · (1 + Σᵢ βᵢ[OH⁻]ⁱ)

The free-ion term falls with pH (slope −2 on a log plot) while the anionic hydroxo complexes rise. Together they give the **amphoteric solubility minimum**. The mean species charge z̄ = Σ αᵢ(2 − i) feeds the charge balance.

## Data (25 °C) — status in `../VERIFICATION.md`
| Metal | log K_sp | log *β₁ | log *β₂ | log *β₃ | log *β₄ | Model minimum |
|---|---|---|---|---|---|---|
| Ni(OH)₂ fresh | −15.2 🔴 | −9.54 (NEA) | not selected (NEA) | −29.2 (NEA) | — | pH ≈ 9.95 |
| Cu(OH)₂ | −19.33 | −7.95 | −16.2 | −26.60 | −39.74 | pH ≈ 9.7 |
| ε-Zn(OH)₂ (crystalline) | −16.62 | −8.96 | −17.82 | −28.05 | −40.41 | pH ≈ 9.5–10 |

Sources:
- Zn: IUPAC critical review, Powell et al. (2013), *Pure Appl. Chem.* 85:2249.
- Cu: IUPAC, Powell et al. (2007) *Pure Appl. Chem.* 79:895 (all four hydrolysis constants).
- Ni hydrolysis: NEA TDB review, Gamsjäger et al. (2005) *Chemical Thermodynamics of Nickel*. Ni(OH)₂(aq) is not selected and is omitted. The fresh-precipitate Ksp is a game choice; crystalline β-Ni(OH)₂ is log*Ks0 11.03.
- Ni and general data: Baes & Mesmer (1976) *The Hydrolysis of Cations*; Stumm & Morgan (1996); Benjamin (2015) *Water Chemistry*.

Reported values differ by about an order of magnitude between fresh/amorphous and aged/crystalline solids. Fresh precipitates are used for Ni because wastewater solids form freshly. Zn uses the crystalline ε phase because it is the critically reviewed IUPAC set.

**Temperature:** the constants are 25 °C values on the H⁺ basis (*K_s0 = K_sp/Kw²), and solubility is evaluated with [OH⁻] from pKw(25 °C). Temperature dependence is therefore genuinely neglected, rather than introduced indirectly through pKw(T). The chemist's review found the earlier version drifted by about 0.6 log units per 10 °C.

**Consistency note:** K_sp and β values must come from one consistent dataset, because mixing sources shifts the minimum. The first draft mixed an amorphous Zn K_sp (−15.5) with an older *β₂ (−16.9), which gave a 2.7 mg/L minimum. Zn now uses the single IUPAC 2013 dataset.

Model values (chemist review):
- Ni minimum at pH ≈ 9.95 after the NEA correction (was 10.2)
- Cu minimum ≈ 0.002 mg/L at pH 9.7
- Zn minimum ≈ 0.05 mg/L at pH 9.8; zincate ≈ 3 mg/L at pH 12

## Gameplay consequences (intended)
- Ni needs a higher pH than Cu or Zn, so a mixed-metal waste has a **compromise pH**. Overshooting re-dissolves Zn as zincate.
- Real effluents rarely reach theoretical solubility because fine particulate metal escapes separation. The model reproduces this through the solids pools (see `precipitation.md`).
- Complexing agents (EDTA, NH₃, citrate) keep metals in solution. They are **not modelled in Phase 1** and are planned with sulfide precipitation for Phase 2.
