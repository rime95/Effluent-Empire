# Activated Sludge (Phase 1: steady-state CSTR with recycle)

Module: `src/simulation/biological/activatedSludge.ts`. Kinetics are in `microbial_kinetics.md`.

## Governing equations
Metcalf & Eddy, *Wastewater Engineering* (5th ed.), Ch. 7–8, COD basis. SRT = θ_X, HRT = τ = V/Q.

| Quantity | Equation |
|---|---|
| Effluent soluble bCOD | S = K_s(1 + b·SRT) / (SRT(μ − b) − 1) |
| Heterotroph production | P_X,H = Q·Y(S₀ − S) / (1 + b·SRT) |
| Cell debris | P_X,d = f_d·b·P_X,H·SRT |
| Nitrifier effluent NH₄-N | N = K_n(1 + b_n·SRT) / (SRT(μ_n − b_n) − 1) |
| Nitrifier production | P_X,N = Y_n·NOx / (1 + b_n·SRT) |
| Oxygen demand | R_O = Q(S₀ − S) − 1.42(P_X,H + P_X,d) + 4.57·Q·NOx − 1.42·P_X,N |
| Reactor solids | X = (SRT/τ) · (net solids production per L of influent) |
| F/M | F/M = Q·S₀ / (V·X_VSS)   (kg bCOD/kg VSS·d; warning above 1.0 ≈ 0.6 on BOD basis) |

Here μ = μ_max·I·DO/(K_O + DO), where I is the product of the inhibition factors below.

## Assumptions
- S₀ = SS + XS: slowly biodegradable particulates are fully hydrolysed at SRT > ~3 d.
- **XI (inert particulate)** passes into the floc and leaves with the waste sludge. **SI (inert soluble)** passes through, and is the COD that biology cannot remove.
- **Washout** happens when SRT(μ − b) ≤ 1, giving S = S₀. Without a secondary clarifier directly downstream, SRT = HRT.
- **Nitrogen:** assimilation uses 0.124 g N/g VSS. If NH₄-N is insufficient (BOD:N above about 100:5), heterotroph μ is scaled by f_N, found by bisection so uptake equals supply. Nitrogen is never created. The game reports "nutrient-limited growth".
- **Alkalinity / charge:**
  - NH₄⁺ uptake: Cb −1 eq/mol N.
  - Nitrification NH₄⁺ → NO₃⁻: Cb −2 eq/mol N, equivalent to 7.14 mg CaCO₃/mg N.
  - VFA oxidation removes A⁻, which raises pH.
  - Aeration fixes [H₂CO₃*] at 10× air saturation (`acid_base_chemistry.md`).
- **pH self-consistency:** the highest self-consistent reactor pH is taken (seeded, healthy reactor).
- **Bioflocculation:** colloids are enmeshed into floc (v₅₀ 3 m/h).
- **O&G** sorbs onto floc with partition fraction K·X/(1 + K·X), K = 3 L/g (GAME MODEL, no direct source; tuned so a well-run plant reaches < 10 mg/L from about 100 mg/L).
  - 80 % of sorbed oil is biodegraded. Its COD (2.9 g COD/g fat) joins the substrate, so it adds oxygen demand and biomass.
  - The rest is wasted with the sludge.
  - Heavy oil loads need gravity separation or DAF first.
- **Washout:** particulate XS is not hydrolysed without active biomass.
- **Organic N:** not modelled. TKN in proteins would be ammonified in the reactor, adding NH₄-N and alkalinity, so the model is conservative about N supply. Industry templates set NH₄-N to the expected TKN. Planned for Phase 2.
- Denitrification and biological P removal are not modelled in Phase 1.

## Inhibition (GAME MODEL; verify thresholds)
Heterotrophs and nitrifiers have separate factors. Nitrifiers are far more sensitive.

| Factor | Heterotrophs | Nitrifiers |
|---|---|---|
| pH | 1 at 6.5–8.5, linear to 0 at 5.0 and 10.0 | 1 at 7.2–8.5, linear to 0 at 5.5 and 10.0 |
| Dissolved metals, I = 1/(1 + Σ C/K_I) | K_I Cu 1.0, Ni 2.5, Zn 5.0 mg/L | K_I Cu 0.25, Ni 0.4, Zn 0.3 mg/L |
| Bulk O&G (after sorption) | I = 1/(1 + O&G/150) | same |

The nitrifier K_I values sit inside the US EPA *Local Limits* (2004) nitrification inhibition ranges: Cu 0.05–0.48, Ni 0.25–0.5, Zn 0.08–0.5 mg/L.

## BOD₅
BOD₅ = 0.61·(SS + XS) + 0.5·biomass.
- BODu ≈ 0.90·bCOD, because part of bCOD ends up as non-oxidised cell residue; BOD₅/BODu = 0.68.
- The biomass pool exerts about 0.5 mg BOD₅ per mg VSS (rule of thumb 0.5–0.65 mg BOD₅/mg TSS).

Effluent BOD is dominated by escaping biomass, which is why clarifier performance matters.

## Worked example (`tests/simulation/units.test.ts`)
20 °C, SRT 10 d, DO 2 mg/L, S₀ = 300 mg bCOD/L, no inhibition:
- μ = 6.0 × 2/(0.2 + 2) = 5.4545 d⁻¹; b = 0.12 d⁻¹
- S = 8(1 + 1.2) / (10(5.4545 − 0.12) − 1) = 17.6/52.345 = **0.336 mg/L**
- P_X,H = 0.45(300 − 0.336)/(1 + 1.2) = **61.29 mg VSS/L**
- P_X,d = 0.15 × 0.12 × 61.29 × 10 = **11.03 mg VSS/L**
- SRT_min = 1/(μ − b) = 0.19 d, so SRT 0.15 d washes out.

## Reference train
Oil separator → EQ → activated sludge (V = 3Q, SRT 10 d) → clarifier (SOR 0.4 m/h avg) → sand filter. It passes Standard B for food seeds 1–5. High-strength food wastewater needs long HRT (about 3 d) to keep MLSS clarifiable.
