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
  - CO₂: a steady-state balance of respiration CO₂ (RQ 0.9) against stripping by the aeration air (O₂ demand or mixing minimum). There is no fixed supersaturation (`acid_base_chemistry.md` "Aeration CO₂ balance"). An O₂-limited basin approaches ≈ 25 mg/L CO₂ (set by OTE); a lightly loaded, mixing-limited basin strips towards air equilibrium.
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

## RAS/WAS system and MLSS control (added 2026-11-22)
Plants usually control **MLSS**: operators adjust the waste activated sludge (WAS) rate to hold a mixed-liquor set-point. They do not set the sludge age directly; it follows from the MLSS. The unit therefore offers two wasting-control modes:
- **MLSS set-point** (default for new designs). At steady state, holding X fixes the SRT. With X = (SRT/HRT)·Px/Q, MLSS rises monotonically with SRT, so the SRT is found by bisection in log(SRT) between max(1.05·HRT, 1 d) and 60 d.
  - A set-point above what 60 d can support, or below what the shortest SRT already gives, is flagged.
  - The resulting SRT is shown as "Control: MLSS set-point → SRT".
- **Sludge age (SRT)**: the original model. Reference designs, and older saves without a `control` parameter, use it.

The clarifier solids balance, neglecting effluent solids, gives:

    (Q + Qr)·X = (Qr + Qw)·Xr   →   Xr = [(1 + R)·X − Px/Q] / R        Q_RAS = R·Q        Q_WAS = Px,TSS / Xr

- The RAS ratio R defaults to 0.75. The usual range is 0.25–1.0, up to 1.5.
- Xr above about 8,000–12,000 mg/L is beyond what a clarifier can thicken, and is flagged.
- The secondary clarifier's SLR uses R.
- Its sludge port is the WAS line, at solids fraction Xr/10⁶.

On the PFD, the RAS line goes from the clarifier's RAS nozzle back to the aeration basin.
- It is shown, with flow R·Q at Xr, in the stream table and on the P&ID (RAS pumps P-xxR/S).
- It is **internal to the model**: biomass retention is already in the steady-state solution, so the solver does not re-add it as flow.
- A clarifier after activated sludge without a drawn RAS line gets advice, not an error.

The simpler form X(1 + R)/R overstates Xr by about 20 % for high-strength industrial plants (HRT 3 d, SRT 10 d). The exact form is used, following biology review.

The MLSS search uses the Illinois method (smooth, tight), so recycle loops containing the unit converge. A search that misses the set-point by more than 2 % is flagged, because the biology can change regime with nitrification or pH. The displayed SRT is the one the solver actually used.

🟡 **Limitation:** biomass is counted as TSS with VSS/TSS = 1, whereas M&E uses Px,bio/0.85. For a given MLSS set-point the solved SRT is therefore about 10–15 % long.

In the SCADA replay, MLSS control is a proportional wasting trim: waste rate = (1 + 2·(MLSS − SP)/SP)/SRT_design (GAME MODEL gain). It is capped at 3 × design wasting, standing in for WAS pump capacity; being proportional-only, it leaves a small offset.

## Alkalinity dosing (added 2026-11-22)
Parameters: `alkPH` (hold pH ≥, 0 = off) and `alkReagent`. Code: `activatedSludge.ts`, with the reagents in `aeration.ts` `ALK_REAGENTS`.

The tank's pH controller doses alkali only when the tank would otherwise run below the set-point. It doses just enough to hold that pH. The biology is then evaluated at the set-point, so nitrification recovers and the dose follows the demand.

The dose is found by bisection on g(dose) = pH_computed(set-point, dose) − set-point. This rises with dose, because each reagent adds Cb and, for carbonates, C_T to the CO₂ balance.

| Reagent | eq/mol (Cb) | mol C/mol (C_T) | Purity | Price RM/kg 🟡 |
|---|---|---|---|---|
| NaOH | 1 | 0 | 100 % | 2.0 |
| Na₂CO₃ (soda ash) | 2 | 1 | 99 % | 1.6 |
| NaHCO₃ | 1 | 1 | 99 % | 2.4 |
| Ca(OH)₂ (hydrated lime) | 2 | 0 | 90 % | 0.8 |

- In an aerated tank, hydroxide absorbs respiration CO₂ and ends up as bicarbonate, so per equivalent all four reagents add the same alkalinity.
- Carbonate reagents also bring carbon that the air must strip, so they need more equivalents than caustic to hold the same pH. The penalty grows steeply with the set-point:

  | Set-point | Na₂CO₃ | NaHCO₃ |
  |---|---|---|
  | 7.2 | +5 % | +11 % |
  | 7.8 | +17 % | +42 % |
  | 8.3 | +41 % | +138 % |

  Above pH 8 an info note says so.
- NaHCO₃ is self-limiting in practice: pushing an aerated tank above ≈ 8 with it takes very large doses. That makes it forgiving, and popular for nitrification at pH 7–7.5. Soda ash and caustic are cheaper per equivalent.
- **Lime:** its 10 % impurities become mineral solids, as in the neutraliser.
  - Above pH 7.5, CaCO₃ is supersaturated in the aerated tank (ion product ≈ 1e-7 against calcite K_sp ≈ 3e-9 at pH 8.3), so a scaling warning fires.
  - The alkalinity lost to CaCO₃ precipitation is not modelled.
- **Capped dose:** if more than 0.5 mol/L of alkali would be needed, the tank is shown undosed with an error.
- **Check:** a feed with 31 mg/L alkalinity and 40 mg/L NH₄-N, held at pH 7.2 with NaOH, nitrifies 33 mg N.
  - It needs 7.14 × 33 (238) plus 3.57 × uptake N (≈ 24) less the feed alkalinity, plus the 38 mg/L residual at pH 7.2.
  - That is ≈ 269 mg/L CaCO₃, which is what the model doses (215 mg/L NaOH, 108 kg/d at 500 m³/d).
- **CAPEX:** + RM 35,000 for the day tank, metering pump and pH probe (GAME MODEL).
- **Not modelled:** CaCO₃ precipitation and scaling (only warned about).
- **Dynamic replay:**
  - The dose is paced to flow at the design ratio (feed-forward, no pH trim; GAME MODEL), so load swings still move the pH.
  - The reagent is counted in the SCADA reagent total.
- Tests: `tests/simulation/aerationAlkDose.test.ts`.
