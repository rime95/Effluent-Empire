# SCADA Operations and Process Incidents (Phase 3)

Modules: `src/simulation/dynamic/plantDynamics.ts`, `src/game/incidents.ts`, `src/game/operations.ts` (grab sample during incidents), `src/ui/screens/Scada.tsx`.

## Dynamic plant replay (48 h, 15-min reporting step)
| Element | Model |
|---|---|
| Influent | Design flow × diurnal factor 1 + a·sin(2π(t−8)/24), with a = peakFactor − 1 (≤ 0.8). Averages to 1 over a day (tested). Composition is constant unless a disturbance applies. |
| EQ tank | Level balance: dV/dt = Qin − Qout, Qout = average flow. Below 5 % of volume, outflow falls to what is available. Above 100 %, the excess **overflows untreated** to the discharge, a compliance failure. Contents are a fully mixed blend. |
| pH / precipitation dosing | CSTR with exact washout per 1-min sub-step, 1 − exp(−Q·h/V). PI loop on the probe reading: Kp 0.4 pump-fraction per pH unit, Ti 0.25 h, conditional-integration anti-windup. Pump capacity is 2× the steady average demand. Base raises Cb; acid adds SO₄ (HSO₄⁻ equilibrium). |
| Activated sludge | ASM1 (`biological/asm1.md`), DO PI on kLa, SRT held by wasting. |
| Secondary clarifier | Folded into the AS reactor (carry-over from the Vesilind flux ratio). |
| Other units | Quasi-steady Phase 1 models on each step's inlet. |

**Decision (2026-11-21):** dosing loops are sub-stepped at 1 min. A 15-min control interval against a tank with HRT ≈ 15 min limit-cycled in a bang-bang pattern (pH 6.1 ↔ 9.7). That was a sampling artefact, not plant behaviour. The probe follows BSM1 sensor class A (T90 ≈ 1 min).

**Compliance** is checked at every point against `standards.json`. The result also reports % time compliant, the worst exceedance, aeration kWh, reagent kg and overflow m³.

## Incidents (GAME MODEL probabilities, physics from the modules above)
| Kind | Where | Dynamic disturbance | What the operator sees | Correct action |
|---|---|---|---|---|
| Blower trip | AS | kLa capacity → 0 | Header pressure LOW, odour; DO alarm; NH₃-N then BOD rise | Standby blower (RM 2,000) |
| Dosing pump failure | dosing units | pump output 0 | pH deviation, day-tank level unchanged | Standby pump (RM 800) |
| pH probe drift ±2 | dosing units | measurement offset | Reagent use changed with no production change; bench pH ≠ online. True pH = SP − offset. | Two-point recalibration (RM 300) |
| Toxic metal slug | plants with AS | +2–4 mg/L Cu for 8 h | OUR drops; tint in inlet | Divert to EQ (RM 1,200, needs EQ) or call the customer (free) |
| Hydraulic surge | any | flow × 1.6–2.0 for 12 h | Influent flow HIGH | Divert to EQ |
| Filamentous bulking | AS | settling velocity × 0.35 | Blanket rising, turbid effluent after the peak | Chlorinate RAS (RM 1,500) |

- **Rates:** 6 %/week when no incident or breakdown is active. A covering operator fixes an incident unaided with 25 %/week from the week after it starts. Wrong actions are charged and recorded in `tried`.
- **Weekly grab sample during an incident:** it *replaces* the steady sample. It is taken from the dynamic replay at a random hour 10–30 h into the disturbed day. The steady models can't represent an oxygen-supply or settling failure; the steady AS model has no O₂-transfer limit. OPEX for the week still uses the steady model with the incident's steady form.
- **Warm state:** the replay is warmed (4 × SRT) on the plant's design stream and cached by the full design (params and bypass flags) plus the full stream. Weekly influent noise therefore reuses one warm state, and no state can leak between plants.
- **Quasi-steady units with faults** (e.g. Cr(VI) reduction): a pump trip passes the stream untreated, and a probe offset shifts the true pH to SP − offset. Bypassed (broken-down) units pass through in the replay.
- **EQ conservation:** outflow stops at the 5 % low-level cut-out, and overflowed volume is not blended into the tank. The volume balance is tested.
- Probe drift reading **high** on an acid-dosing loop only drives the pump to 100 % (pump-capacity limited). Reading **low** under-doses and fails the pH maximum. This asymmetry is physical and tested.
- **Set-points from SCADA** (pH SP, DO SP, SRT, coagulant dose) persist into the operated plant's graph. Only whitelisted keys are accepted, clamped to their bounds (`SETPOINTS` in `incidents.ts`); anything else is a design change.
