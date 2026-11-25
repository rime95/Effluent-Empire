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

**Replay basis (2026-11-22).** The SCADA screen replays the plant as it runs *this week*: that week's influent (`commissioningInfluent(seed·97 + week)`) × the growth factor, on the breakdown-degraded graph, with any incident applied. It is the same basis as the weekly grab sample, so the trend and the sample can no longer disagree. Replay times are shown as clock time, D1/D2 hh:mm.

**Trend display rules (2026-11-22)** (`src/ui/components/trendScale.ts`, tests in `tests/ui/trendScale.test.ts`):
- Tags of the same quantity share one labelled axis (pH true + probe + set-point; % for pump, blower, level; DO; MLSS; mg N/L…).
- There are at most two axes, left and right. A third quantity is listed as "not plotted" rather than drawn against a hidden scale.
- Each axis has a minimum span, so instrument-scale noise is drawn as a flat line: pH 1 unit, % 20, DO 2 mg/L, otherwise 20 % of the mean.
- Set-points and discharge limits are always inside the range.
- Ranges are clipped to physical bounds.
- Tick decimals follow the tick step, so labels can never repeat.

These replaced per-series hidden autoscaled axes, which had made a pH held at 9.50 ± 0.001 fill the chart with every tick labelled "9.5".

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

## Live plant view (added 2026-11-22)
The SCADA screen opens on a **live plant view**: the as-built PFD (same node positions as the Studio, `src/ui/studio/layout.ts`), with each unit drawn as a side-view cross-section tank (`src/ui/scada/tanks.tsx`). The 48 h replay plays as a live feed: play/pause at 1×, 4× or 12× replay hours per second. The trend cursors follow, and dragging the slider pauses playback.

- **Water colour.** Each pipe and tank is coloured by a display water-quality index (`src/simulation/treatment/waterQuality.ts`, GAME MODEL, visual only). The index is not regulated.
  - It is the worst value ÷ limit ratio over COD, BOD₅, TSS, O&G, NH₃-N, the metals and Cr(VI) against the plant's own standard. pH counts each unit outside the range as a 10× exceedance.
  - It is mapped as `wq = clamp(log10(ratio) / log10(30), 0, 1)`. Meeting every limit gives 0, clean blue; 30× the worst limit or more gives 1, brown.
  - The log scale means the colour shifts step by step as each unit removes its share.
- **Pipe data.** Each replay step records, per pipe, the flow and `wq` (`TrendPoint.edges`). Sludge and RAS lines are quasi-static in the replay, so their flow comes from the steady model; they are drawn brown and flagged `sludge`. Reject lines (brine, backwash, eluate, concentrate) keep their real quality.
- **Movement.** Dash speed and pipe width scale with log flow. A pipe with no flow at that hour is grey and still.
- **Tank animations.** EQ fills to its live level. Stirred reactors turn while the dosing pump runs. Aeration basins bubble with the blower. Clarifiers show a sludge blanket.
- **Reduced motion.** With `prefers-reduced-motion` the animation stops, and only colours and readings update.
- **Readouts.** A faceplate under every unit shows 2–4 live tags at the playback hour. The tag choice follows the trend panel (`src/ui/scada/tags.ts`).
  - Alarm thresholds match the alarm log: DO < 0.5, EQ level > 95 %, probe more than 0.5 pH from the set-point, pump at 100 %.
  - A tag whose instrument is not installed shows "no instrument".
  - Units with no tags show outlet flow and a quality word (clean / treated / turbid / raw).

## Weekly grab sample of manually controlled plants: cached replay (2026-11-26)
User report: "Next week" was slow. A plant missing a pH or DO loop re-ran a 20 h dynamic replay every week (~1.5–1.8 s per plant). `cachedManualGrab` (operations.ts) now runs the replay once per plant design, standard and 5 % production step, on the design influent scaled to that flow, and each week picks its sampling hour from it. GAME MODEL: weekly influent noise reaches the result through the steady simulation (combined with the sample), not through the replay. About 28× faster per plant-week.
