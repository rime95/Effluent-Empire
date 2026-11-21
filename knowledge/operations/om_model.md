# Operation & Maintenance (Phase 2)

Module: `src/game/operations.ts`. Every number here is a GAME MODEL value tuned for play, not engineering data.

## Contract (revised 2026-11-22: fixed service fee + reimbursables)
After a successful commissioning, the customer offers a 3-year (156-week) O&M contract. It is structured like a typical Malaysian industrial O&M service contract: a **fixed monthly service fee** plus **reimbursable consumables**. All rates are GAME MODEL; `verify:` against current contracts.

**Fixed monthly service fee** = cost base × (1 + margin), rounded to RM 10.

| Cost-base item | RM/month | Notes |
|---|---|---|
| Plant operators | FTE × 3,500 × 1.40 on-costs | FTE = 0.5 (Q < 50 m³/d), 1 (< 300), 2 (≥ 300); +0.5 for a piped-in activated-sludge unit. This assumes day-shift plants with alarm call-out, not 24/7 manning. Statutory on-costs are ≈ 15 % (EPF 13 %, SOCSO ≈ 1.75 %, EIS 0.2 %); the rest covers leave, overtime and PPE. `verify:` FTE rule, salary (RM 2.2–3.5k typical) |
| CePIETSO competent person | 0.15 × 8,000 × 1.40 | Certified Environmental Professional, part-time supervision (Environmental Quality (Industrial Effluent) Regulations 2009). `verify:` regulation number, whether contractor part-time cover satisfies DOE, separate phys-chem/biological certificates, rate (RM 4–6k employed is typical) |
| Preventive maintenance | 2 %/yr × CAPEX ÷ 12 | |
| Compliance sampling | n_params × RM 25 × 52/12 | Weekly grab sample of every parameter the standard regulates. The total (≈ RM 1.5k/month) is plausible, but the build-up is simplified: DOE reporting is usually monthly, BOD/O&G cost more and pH/T are field readings. `verify:` |
| Management & insurance | 10 % of the above | Head-office overhead recovery: the company already pays office overheads, so this is **not** charged to the plant again. `verify:` |

- **Margin:** 100–150 % on the cost base. It is 125 % at reputation 0, ±25 points per 50 reputation, clamped. This range was set by the player (2026-11-22) and is **game balance**; real O&M margins are about 10–30 % on cost.
- **Staffing matches the fee (2026-11-22, player decision).** Each hired operator staffs 1 post, or 1.5 when senior. Each operating plant needs the posts its contract bills (`plantPosts` = `quote.operatorFTE`, 0.5–2.5). Plants are staffed in portfolio order; a plant is covered only when all its posts are staffed, otherwise it wears faster and breakdowns last longer. The billed staffing line is therefore a real cost. Before this, one operator covered 2–3 plants, which pushed the realised margin to about 200–250 %.
- **Reimbursables:** chemicals, electricity and sludge disposal at **market prices** and actual flow, re-billed to the client at cost + 10 % handling. The client carries price and flow risk.
- **Escalation:** the fixed fee and the plant's service costs (CePIETSO, sampling) rise 4 % each contract year, applied as `contract.indexation`. Not applied in the contract's final week. `verify:`
- **Performance deduction:** each failed weekly sample deducts 5 % of the monthly fee. DOE fines remain the operator's.

What the plant pays each week (`operateWeek`):
- the maintenance budget;
- CePIETSO and sampling (cost-base lines ÷ 52/12, escalated);
- chemicals, power and sludge at market prices;
- repairs, SCADA field actions and fines.

Operators are paid through company payroll. The ledger shows the service fee, the reimbursables and plant running costs as separate lines.

**Example** (plating, Q = 90 m³/d, CAPEX ≈ RM 420k, Standard B, reputation 0):
- Cost base: operators 4,900 + CePIETSO 1,680 + maintenance 700 + sampling 1,517 + management 880 = **RM 9,677/month**.
- Fixed fee: × 2.25 = **RM 21,770/month**.
- Old model: RM 2,990/week ≈ RM 12,960/month, out of which the player also paid every chemical, power and sludge bill.

**Why it changed (player feedback):** the old fee was 7·OPEX·1.25 + 1,500 + 1.2·Q per week, fixed for 3 years. It had no allowance for staff, supervision, sampling or risk, and no escalation, while running costs grew with flow (up to ×1.3) and market prices (up to ×1.6). A cheaper-to-run design even earned a lower fee.

**Legacy saves:** lump-sum contracts are re-priced on load to the new model for their remaining term (`repriceLegacyContract`), and a news line says so.

## Weekly simulation
1. **Equipment condition** (0–100):
   - −0.5 per week base wear
   - −0.7 more if no plant operator covers the plant
   - +0.9 × (maintenance budget / recommended), with the ratio capped at 2
   - Recommended budget = 2 % of CAPEX per year.
2. **Breakdowns.** Chance per week = 1 % + 0.06 % × (100 − condition). A random unit fails for 1–2 weeks, or 3 if no operator covers the plant. Repair cost is 0.5–1.5 % of the unit's CAPEX share. Failures change the real process model:

   | Unit | Failure | Effect |
   |---|---|---|
   | Dosing units (pH, precipitation, coagulation, Cr reduction) | Pump failure | Unit bypassed |
   | Activated sludge | Blower failure | DO 0.3 mg/L |
   | Clarifier | Scraper failure | Area × 0.45 |
   | Sand filter | Backwash failure | Area × 0.35 |
   | Carbon | Exhausted carbon | EBCT × 0.25 |
   | EQ tank | Silted | Volume × 0.3 |
   | Oil separator | Skimmer failure | Area × 0.3 |
3. **Influent.** The real wastewater with ±8 % day-to-day variability and **production growth** of +0.15 % flow per week (capped at +30 %). Growth slowly loads clarifiers and filters, foreshadowing upgrade projects.
4. **Grab sample** (Reg. 16(3): grab samples) evaluated against the plant's standard.
   - Pass: satisfaction +1.
   - Fail: satisfaction −6, and a 20 % chance of a DOE inspection. The compound fine starts at RM 20,000 and rises 50 % per repeat, capped at RM 100,000 (the Reg. 32 maximum). Each fine costs −8 reputation.
5. **Contract end.**
   - Satisfaction below 25 %: the customer terminates (−15 reputation).
   - Contract completes with satisfaction ≥ 70 %: +5 reputation.

## Upgrades of operating plants: variation orders (added 2026-11-22, `src/game/upgrade.ts`)
Player feedback: after O&M started, the PFD could no longer be opened and options left unticked at design (standby pumps, control loops, instruments) could never be added.

- **Viewing.** An operating plant's as-built PFD and P&ID open in the Engineering Studio in read-only mode. They are reached from the sidebar ("Operating plants — PFD"), Plants & O&M, or SCADA. The plant is shown on **today's influent**: the design stream × the growth factor.
- **Drafting.** "Propose upgrade" puts an editable copy of the as-built graph into `plant.upgrade` (phase `draft`). Units, options, sizes and instruments can all be changed.
- **Price** (`retrofitCharge`, shared with failed-commissioning retrofits):
  - A new unit, or one with changed kind/hardware parameters, is charged full unit CAPEX × 1.2 rework premium.
  - A unit whose **only** change is instrumentation or redundancy is charged for the added instruments only, × 1.2.
  - **Operator set-points** (the SCADA `SETPOINTS` keys) are not works and are never charged.
  - Removals and re-piping are free but count as works (time).
  - **Bug fixed:** retrofits used to ignore `inst`, so ticking an instrument in a retrofit cost RM 0.
- **Duration:** 1 + ⌈0.6 × (changed + removed units)⌉ weeks, or 1 week for re-piping only. The plant keeps running on the old design until hand-over.
- **Payment:** the operator pays the whole works cost when ordering.
- **Funding scope is per unit**, like an instructed VO (wwtp-process-engineer review). The client pays (scope cost) × 1.25 at hand-over for:
  1. **Compliance.** Applies when the as-built hardware fails its standard on today's influent, judged with the draft's set-points so a detuned set-point does not count. The plant must also have failed ≥ 2 of its last 4 weekly samples. In scope are the changed units without which the draft fails again: each is reverted, or bypassed if new, and re-simulated. A new unit that cannot simply be bypassed counts as needed.
  2. **Reliability.** Instruments or standby added on a unit with an unused incident in the last 12 weeks, where the instrument remedies that incident kind (`INCIDENT_REMEDY`): standby for pump and blower trips, flow and level for slugs and surges, a DO loop for bulking. Only those instruments are in scope. Each incident funds one VO (`used`). Incidents absorbed by an existing standby are not logged.

  Everything else in the draft is operator-funded. It pays back through fewer incidents: with a standby installed, a pump trip changes over automatically.
- **Hand-over** (`completeUpgrade`):
  - the graph is replaced, keeping the live SCADA set-points;
  - asset CAPEX = the upgraded plant's CAPEX (the rework premium is a sunk project cost, not a maintenance base);
  - the maintenance budget follows the new recommendation if it was at least the old one;
  - **only a client-funded VO re-prices the fee:** new cost base at today's flow, the contract margin and its indexation, up or down.
- **Gates:**
  - the draft must meet the standard on today's influent;
  - the contract must run past the hand-over week;
  - if the contract still ends during the works (termination), a client-funded VO is settled and operator-funded works are lost.

All GAME MODEL; `verify:` the VO markup (1.25) and the premium (1.2). The client pays 1.2 × 1.25 = 1.5 × new-build unit CAPEX, within the usual brownfield-plus-O&P range of about 1.3–1.6.

## Calibration (`tests/game/phase2.test.ts`)
A staffed, maintained reference plant is more than 85 % compliant and profitable over a year. Typical results:
- 0–2 failed samples per year.
- About RM 120–250k net per year per plant before operator salary (fixed-fee model; `tests/game/omContract.test.ts`). The old lump-sum model gave about RM 90–120k.
- Neglected plants (no maintenance, no operator) lose more than 40 condition points per year.

## Staff (`src/game/staff.ts`)
| Role | Effect | Salary (RM/month) |
|---|---|---|
| Engineer | 1 concurrent project each (the founder counts) | 5,500–11,500 |
| Lab technician | −15 % lab cost each (max −45 %); 2-week tests take 1 week | 3,000–4,800 |
| Plant operator | staffs 1 operator post (1.5 when senior); a plant needs 0.5–2.5 posts | 2,800–4,200 |
| Sales engineer | +1 enquiry each (max +3), larger and better-paid jobs | 5,000–9,500 |

Salaries are indicative Malaysian ranges (🔴 not verified).

## Time
Lab tests and construction finish on future weeks; the company clock only moves with "Next week" or "Skip to next event". A project's commissioning outcome is computed when construction starts (deterministic) and revealed on completion. Construction is paid up front, with a credit line of RM 100k. The 60 % milestone arrives at completion. Six consecutive weeks of negative cash means insolvency.

## Project cash flow (revised 2026-11-22, player feedback: "ran out of cash before the build finished")
| Item | Before | Now (GAME MODEL) |
|---|---|---|
| Construction CAPEX | all up front at build start | paid weekly over the construction weeks |
| Client 60 % payment | at mechanical completion | weekly progress claims over the build, as in industry valuations |
| Advance and retention | 30 % at signing, 10 % on passing | unchanged |
| Credit line | RM 100,000 | RM 250,000 overdraft facility |
| Overdraft interest | none | 0.15 %/week on a negative balance (≈ 8 %/yr) |
| Insolvency | after 6 weeks of any negative cash | after 6 weeks beyond the credit line |
| Customer OPEX expectation | 1.3–1.8 × reference OPEX + 20 | 1.8–2.5 × reference OPEX + 80 RM/d |

**Legacy behaviour:** builds already in progress in old saves (paid up front) still receive the 60 % at completion.

**Probe (tests):** a typical default-sized train costs 60–75 % of the contract value. The loss was cash timing, not margin.
