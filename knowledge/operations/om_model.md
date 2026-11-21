# Operation & Maintenance (Phase 2)

Module: `src/game/operations.ts`. Every number here is a GAME MODEL value tuned for play, not engineering data.

## Contract
After a successful commissioning, the customer offers a 3-year (156-week) O&M contract.

    weekly fee = 7 · OPEX(base prices) · 1.25 + RM 1,500 + RM 1.2 · Q(m³/d)

The operator (the player) pays:
- chemicals, electricity and sludge disposal at **market prices** (`market.ts`);
- maintenance budget and repairs;
- DOE fines.

Operator salaries are paid through payroll.

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

## Calibration (`tests/game/phase2.test.ts`)
A staffed, maintained reference plant is more than 85 % compliant and profitable over a year. Typical results:
- 0–2 failed samples per year.
- About RM 90–120k net per year per plant before operator salary.
- Neglected plants (no maintenance, no operator) lose more than 40 condition points per year.

## Staff (`src/game/staff.ts`)
| Role | Effect | Salary (RM/month) |
|---|---|---|
| Engineer | 1 concurrent project each (the founder counts) | 5,500–11,500 |
| Lab technician | −15 % lab cost each (max −45 %); 2-week tests take 1 week | 3,000–4,800 |
| Plant operator | covers 2 plants (3 when senior) | 2,800–4,200 |
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
