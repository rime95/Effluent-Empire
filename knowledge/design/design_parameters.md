# Design Parameters (hydraulic loading, retention time, F/M, sludge age, aeration)

This file covers `hydraulic_loading`, `retention_time`, `f_m_ratio`, `sludge_age` and `aeration_requirements`. The sections are kept together while Phase 1 is small.

## Hydraulic retention time
HRT = V/Q (d). Example (tested): V = 500 m³, Q = 250 m³/d → HRT = 2 d.

## Surface overflow rate (hydraulic loading)
SOR = Q/A (m³/m²·d), or Q/(24A) in m/h. It is evaluated at **peak** flow for performance. Example (tested): Q = 480 m³/d, A = 20 m² → 1.0 m/h.

| Unit | Typical design SOR at peak |
|---|---|
| Chemical-floc clarifier | 1.0–1.5 m/h |
| Secondary clarifier (activated sludge) | 0.7–1.2 m/h |
| API oil separator | ≤ 2 m/h (150 µm droplet design) |
| Rapid sand filter (filtration rate) | 5–10 m/h |

## Equalisation (GAME MODEL)
PF_out = 1 + (PF_in − 1)·exp(−HRT_h/6 h). About 8 h of storage takes a typical single-shift discharge pattern down to near-average flow.

## Sludge retention time (sludge age)
SRT = mass of solids in the reactor / mass wasted per day. In Phase 1 SRT is a design input, controlled by wasting. It is forced equal to HRT when no clarifier retains biomass.

## F/M ratio
F/M = Q·S₀/(V·X_VSS). Conventional plants run at 0.2–0.4 kg BOD/kg VSS·d and extended aeration at 0.05–0.15. Above about 0.6 (bCOD basis) a poor-settling warning is shown.

## Aeration requirement
R_O from the activated-sludge mass balance (`biological/activated_sludge.md`). Blower energy = R_O / AE, with field aeration efficiency AE = 1.2 kg O₂/kWh for fine-bubble diffusers (verify; the clean-water SAE of about 3–6 kg/kWh is derated by α, β, temperature and DO). Mixing energy is 3 W/m³ for aeration basins and 5 W/m³ for EQ tanks.
