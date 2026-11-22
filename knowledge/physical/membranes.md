# Membranes: UF and RO

Module: `src/simulation/physical/membranes.ts`. Technology Tree: UF (T2), RO (T3, needs UF).

## Membrane split (GAME MODEL)
With recovery r = Q_permeate/Q_feed and observed rejection R per species:

    CF_avg = ln(1/(1−r)) / r          (log-mean concentration along the train)
    C_p = C_f·(1−R)·CF_avg             (capped at C_f)
    C_c = (C_f − r·C_p)/(1−r)          (mass closes exactly)

- The concentrate leaves through the second port as a **liquid reject** (`ProcessResult.reject`), with its own flow and concentrations. It can go to the discharge, an evaporator, liquid haulage or a mixer; it may not go to the reclaim system.
- **Charge consistency:** every strong ion (salts, Cb, SO₄, metals, NO₃) uses one salt rejection. NH₄⁺ passes more easily (0.93); the extra NH₄⁺ takes its counter-anion with it, so Cb is moved from brine to permeate by the same equivalents. CO₂ passes (CT 0.6), so permeate pH falls and brine pH rises.

## UF
- Particulate rejection 0.9999 (4-log), emulsion 0.95; dissolved species pass.
- Recovery is limited by backwash: r_max = 0.96 − 0.002·(J − 50 LMH) − 0.0002·TSS, floor 0.75.
- Warnings: flux > 80 LMH, TSS > 300 mg/L, free oil > 5 mg/L.
- Energy 0.15 kWh/m³; NaOCl CEB 2 mg/L (`verify:`).

## RO (brackish-water polyamide)
- **Rejection** (`verify:` vendor data): salts 0.985, NH₄ 0.93, CT 0.6, soluble COD 0.95–0.97.
- **Pressure** P = π_f·CF_avg + 10 bar, with π ≈ 0.7 bar per 1,000 mg/L TDS (NaCl ≈ 0.79, `verify:`).
- **Energy** = P/(36·η), η = 0.75. Example: 1,500 mg/L feed at 75 % recovery → ≈ 12 bar → 0.45 kWh/m³ feed.
- **Scaling limit:** concentration factor ≤ 2.5 without antiscalant, ≤ 6.7 with (`verify:` projection software). Beyond it, salt rejection × 0.92 and energy × 1.3.
- **Fouling:** feed TSS > 2 mg/L or oil > 0.5 mg/L gives energy × 1.2 and a warning that UF is needed. Biodegradable COD > 50 mg/L gives a biofouling note.
- **Warnings:** concentrate π > 35 bar (beyond brackish-water element ratings).
