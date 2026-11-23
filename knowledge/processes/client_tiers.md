# Client tiers, real names and developer mode (added 2026-11-22)

## Tiers (`src/game/customers.ts → TIERS`, `tierDesign`)
| Tier | Unlock | Contract value | OPEX cap | Contract terms |
|---|---|---|---|---|
| Basic (local SME) | start | as before | as before | discharge standard |
| Medium (large local company) | reputation 25 | × 1.8 | × 1.5 | Standard A where reachable, duty/standby on every dosing pump and blower |
| MNC (multinational) | reputation 50 + water reclaim researched | × 3 | × 3 | as medium, plus a reuse target or zero liquid discharge |

GAME MODEL multipliers (`verify:` against real tender spreads). These are all on top of the usual reference-design pricing.

- **Draw.** When eligible, 25 % of new enquiries are MNC; otherwise 30 % are medium.
  - The draw uses its own RNG stream, `seed·104729 + 31`, so the base enquiry for a seed (wastewater, industry, price draws) is unchanged.
  - A tier client is never also a tough-job variant.
- **Terms are set like a feasibility study.** The contract is the strictest target the reference design actually meets on this feed:
  - **MNC candidates, in order:**
    1. ZLD (platers, once the evaporator is researched; half of them);
    2. a reuse split of 70 %, then 50 %, then 35 % of the flow through GAC → UF → RO 75 %, with brine and backwash blended back to the discharge.
  - **Reuse target.** `reuseMin` = split × 0.92 (UF recovery) × 0.75 (RO recovery) × 0.95 margin, rounded down to 5 %. That gives 45 / 30 / 20 %.
  - **Brine raises the discharge concentration.** The RO brine carries about 4× the residual COD and NH₃ of the bypassed share, so larger splits fail the standard on weaker trains. That is why there is a fallback.
  - **Fallback to medium.** If no MNC candidate meets a standard and its terms, the job is offered as a medium-tier job.
  - **Standard.** A if the reference reaches it, else B. If neither is reached, the drawn standard is kept, as for basic jobs.
- **Standby requirement (`requirements.ts → standby`).** It fails if any unit that can carry a standby machine (dosing units, Cr(VI) reduction, activated-sludge blowers; `instrumentation.ts`) has none installed.

## Real company names (`src/game/realClients.ts`)
- **Lists.** 15 names per industry per tier: large Malaysian listed companies for medium, multinationals with Malaysian plants for MNC. No name repeats while it is in play (same rule as the generic names).
- **Neutral wording.**
  - Names are flavour only: every wastewater, number and event is fictional.
  - Game text never names a client as the cause of a breach. DOE fines, failed samples and terminations refer to "the treatment plant you operate for X", i.e. the player's own plant.
- **Fictional names (pause menu, per device).** Every real name shown in the UI is replaced by a fixed alias (`fictionalAlias`, e.g. "Apex Semiconductor International"). Saves keep the real name, so the toggle is reversible. Text containing a name (news, ledger, toasts) is rewritten by `brandText`.
- **Publishing.** If the game is ever published or sold, ship with fictional names on, or replace the lists (trademark risk).

## Developer mode (pause menu → "Developer mode")
- **Scope.** It is set per company. Using it marks the save DEV in the topbar and in the save list.
- **Tools (`store.ts → applyDev`):**
  - cash grants, booked as "Developer: cash grant";
  - set reputation;
  - unlock all technology free, or reset the tree;
  - spawn an enquiry with a chosen industry, tier or tough-job variant;
  - lab results next week;
  - load the job's pricing reference design (tier / variant / base train) into the Studio.
- **Intended use.** It is for checking new content. Use "Save as new slot" first to keep a real company clean.

## Flagship ESG tier (added 2026-11-22)
A multinational's showcase plant for its ESG report. `TIERS.flagship` in `customers.ts`; terms in `requirements.ts`.

| Unlock | Contract value | OPEX cap | Contract terms | ESG bonus |
|---|---|---|---|---|
| Reputation 70 + water reclaim | × 5 | × 4 | Standard A; standby; ZLD or a reuse target; effluent ≤ x % of every Std A limit; net energy ≤ y kWh/m³; sludge ≤ z kg DS/m³ | 10 % of the contract value, split equally over the green terms |

All multipliers are GAME MODEL, `verify:`. When eligible, 15 % of new enquiries are flagship (own RNG stream `seed·104729 + 61`), checked before the MNC draw.

- **Design basis.**
  - With the evaporator researched, any industry tries a zero-liquid-discharge reference first. It works on food and semiconductor feeds, whose base trains cannot beat Standard A.
  - Otherwise the MNC water design is used (reuse split or ZLD).
  - If that design cannot meet Standard A, or cannot beat it with margin, the job is offered as an MNC job.
- **Targets are set from the chosen reference design** × `FLAGSHIP_SLACK` 1.2, rounded up, so every flagship job is winnable:
  - **Effluent factor** (only when something is discharged): the worst value ÷ Std A limit over every parameter with a maximum, temperature and pH excluded, with Reg. 11(2) combined metals counted where they apply. It is clamped to 0.3–0.9; a design that can't get under 0.9 isn't a flagship.
  - **Net energy:** (plant kWh/d − biogas CHP kWh/d) ÷ total inflow.
  - **Sludge:** `sludgeKgD` ÷ total inflow, in kg dry solids per m³.
- **ESG bonus.**
  - The green terms are effluent factor, energy, sludge, reuse and ZLD. Each one beaten by 10 % (a cap at ≤ 90 % of the limit, a reuse target by +10 %, ZLD when met) earns its equal share of the bonus pool.
  - The bonus is paid with the retention at a passed commissioning and booked as "ESG bonus".
  - Beating every green term adds +5 reputation.
- **Names.** The multinational list, labelled "Flagship ESG project".

## Integrated megaproject — the "final boss" tier (added 2026-11-23)
User request: the highest tier needs almost every technology — high strength, several streams, the strictest terms.
- **Who / when:** plating only; reputation ≥ 80 and electrowinning, evaporator, RO, UF, reclaim, dryer and sulfide all researched. 25 % of eligible plating enquiries (own RNG stream, seed·104729+131; overlay seed·7919+53). Names from the multinational list. Value ×6, OPEX allowance ×5 (flagship ×5 / ×4).
- **Wastewater (`megaOverlay`):** main rinse Ni 40–80, Cu 25–50, Zn 10–25 mg/L, TDS ×1.5–2.5; then the chrome, electroless-nickel and nickel-rinse overlays of those clients are applied in turn (each takes its share of the remaining flow) → three segregated drains `cr`, `en`, `ni`.
- **Reference design (`megaGraph`):** Cr(VI) reduction on the chrome drain; precipitation + NaHS on the EN drain (joins at coagulation); low-current-density electrowinning on the nickel rinse (85 % design recovery); main metal train → UF → RO → evaporator (ZLD); thickener → filter press → dryer on the clarifier sludge. Every pump/blower duty/standby.
- **Terms (from the reference × slack 1.25, GAME MODEL):** ZLD; standby; **wet sludge cake ≤ 1.25 × reference** (`cakeWetMax_kgd`, solid disposal only — evaporator concentrate haulage is excluded, because it dominates the disposal cost and would hide the dryer); **metal recovered by electrowinning ≥ reference ÷ 1.25** (`metalRecoveryMin_kgd`).
- **Each unit binds (tested):** without the dryer the cake is ~2.5× the cap; without electrowinning the recovery term fails. The EN sulfide step is not forced by a term under ZLD (complexed Ni would end in the hauled concentrate) — it is the cheaper route, not a requirement.
- No ESG bonus (that stays with the flagship). Build period 24 weeks; never rolled as a "demanding client".
