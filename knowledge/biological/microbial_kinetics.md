# Microbial Kinetics (Monod / Lawrence–McCarty)

Specific growth rate: μ = μ_max · S/(K_s + S) · DO/(K_O + DO) · I

Endogenous decay: r_d = −b·X

Temperature correction (Arrhenius form): k_T = k₂₀ · θ^(T−20)

## Coefficients at 20 °C — Metcalf & Eddy 5th ed., Table 8-14 (single edition) — 🔴 not confirmed online; see `../VERIFICATION.md`
| Organism | μ_max (d⁻¹) | θ_μ | K_s / K_n (mg/L) | θ_K | Y (g VSS/g) | b (d⁻¹) | θ_b | K_O (mg/L) |
|---|---|---|---|---|---|---|---|---|
| Heterotrophs (bCOD) | 6.0 | 1.07 | 8 bCOD | 1.00 | 0.45 /g bCOD | 0.12 | 1.04 | 0.20 |
| Nitrifiers, AOB (NH₄-N) | 0.90 | 1.072 | 0.50 N | 1.00 | 0.15 /g N | 0.17 | 1.029 | 0.50 |

The first draft mixed 4th-edition values (K_s = 20, θ_Kn = 1.053); the biological review corrected this. Only AOB are modelled, and the NOB yield (about 0.05) is neglected.

Cell debris fraction f_d = 0.15. Biomass formula C₅H₇O₂N gives 1.42 g COD/g VSS and 0.124 g N/g VSS.

Malaysian wastewater runs at 28–34 °C. At 30 °C nitrifier μ_max is 0.9 × 1.072¹⁰ ≈ 1.8 d⁻¹, so nitrification is reliable at SRT ≥ 5 d when alkalinity and DO allow.

Minimum SRT for growth: SRT_min = 1/(μ − b). Design SRT is typically 1.5–3× SRT_min for nitrification and 3–15 d for conventional plants.
