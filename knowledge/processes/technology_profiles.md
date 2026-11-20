# Treatment Technology Profiles (Phase 1 units)

The catalogue (`src/simulation/treatment/catalogue.ts`) and the in-game Encyclopedia mirror these profiles.

## Equalisation Tank (TK) — physical
- **Objective:** dampen flow and load peaks.
- **Key parameters:** volume and retention time (h).
- **OPEX:** mixing energy.
- **Failure modes:** undersized volume lets peaks overload clarifiers.
- **Compatible industries:** all, especially batch or shift discharges (plating, food).

## Oil Separator (OS) — physical
- **Objective:** remove free oil (Stokes rise) and grit.
- **Key parameters:** surface area, surface loading.
- **OPEX:** skimmed oil disposal.
- **Limits:** emulsified oil passes through; use coagulation to break emulsions.
- **Compatible industries:** food, metal working.

## pH Adjustment (NT) — chemical
- **Objective:** reach a pH set-point; the dose follows the titration.
- **Key parameters:** set-point, reagent (NaOH or lime), retention time ≥ 15 min.
- **OPEX:** reagent.
- **Failure modes:** a short HRT gives unstable control; lowering pH re-dissolves metals.

## Hydroxide Precipitation (PR) — chemical
- **Objective:** convert dissolved metals to hydroxide solids.
- **Key parameters:** reaction pH (each metal has its own optimum), retention time (particle growth).
- **OPEX:** caustic or lime, hazardous metal sludge disposal (scheduled waste SW 204).
- **Limits:** chelated metals are not removed (Phase 2). The solids still need coagulation and separation.

## Coagulation / Flocculation (CF) — chemical
- **Objective:** destabilise colloids and grow floc.
- **Key parameters:** coagulant, dose (jar test), flocculation time, optional pH control.
- **OPEX:** coagulant plus extra sludge.
- **Failure modes:** under-dose; restabilisation; operating outside the coagulant's pH window; alkalinity consumption lowering pH.

## Clarifier (CL) — physical
- **Objective:** gravity separation.
- **Key parameters:** surface area (SOR at peak), depth; for activated sludge, MLSS and settleability.
- **OPEX:** sludge pumping and disposal.
- **Failure modes:** high SOR; blanket washout when SOR approaches the zone-settling velocity.

## Activated Sludge (AS) — biological
- **Objective:** remove biodegradable organics, and nitrify at long SRT.
- **Key parameters:** volume (HRT), SRT, DO, MLSS, F/M.
- **OPEX:** aeration electricity, sludge.
- **Failure modes:** washout; inhibition by metals, pH or O&G; nitrogen limitation; alkalinity loss from nitrification; no secondary clarifier.
- **Not suitable for:** dissolved heavy metals (they inhibit it and pass through) or refractory COD (SI).

## Sand Filter (SF) — physical
- **Objective:** polish residual floc and precipitate.
- **Key parameters:** filtration rate, bed depth.
- **OPEX:** backwash pumping.
- **Failure modes:** high feed TSS; high rate causes breakthrough.

# Industry profiles (`src/game/industries.ts`) — verify ranges
| Industry | Character | Key challenge |
|---|---|---|
| Metal finishing | pH 2.5–4, Ni 5–25, Cu 2–15, Zn 0–8 (sometimes undeclared), low buffer, COD 80–250 (40 % inert) | pH-dependent precipitation, solids separation, alkalinity effect of coagulant |
| Food processing | COD 2 000–5 000 (mostly biodegradable), O&G 60–250, VFA, N at 2.2–3 % of COD | biological sizing, clarifier MLSS limits, oil, nitrification alkalinity |
| Semiconductor | Q 300–1 500, pH 3–5, Cu 5–20, colloidal CMP slurry 100–300 mg/L, NH₄-N | colloid coagulation at scale, Cu precipitation |
