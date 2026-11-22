# Technology Tree (added 2026-11-22)

Module: `src/game/tech.ts`, screen `src/ui/screens/TechTree.tsx`. Player decisions (2026-11-22):
- every unit that existed before the tree is **basic and available from the start**;
- the tree holds only **advanced** technologies;
- research costs **cash only** and is instant;
- each technology opens **tougher clients** that need it.

## Rules
- **Reputation by tier:** T1 10, T2 25, T3 40, T4 60. Prerequisites are listed per technology.
- **Cost** is booked as a `research` ledger line. The cash + RM 250k credit line must cover it.
- **Availability:** a technology is "in development" (not researchable) until its engineering model, knowledge doc and tests are in the game (`available: true`).
- **Studio locks:** locked units appear in the palette with a padlock and cannot be added, pasted or dropped.

| Tier | Technology | Needs | Cost (RM, GAME MODEL, verify) | Opens |
|---|---|---|---|---|
| 1 | DAF | – | 120k | emulsified-oil food / edible-oil refineries |
| 1 | Sludge dryer | – | 150k | sludge-heavy metal finishers with a disposal-cost cap |
| 2 | Ultrafiltration | – | 160k | RO/MBR pretreatment |
| 2 | Sulfide precipitation | – | 140k | Standard A high-nickel platers |
| 2 | Ion exchange | – | 180k | semiconductor Standard A copper polishing |
| 2 | Anaerobic UASB + biogas | – | 300k | palm oil mills (POME) |
| 3 | Reverse osmosis | UF | 350k | high-TDS clients |
| 3 | Water reclaim | RO | 200k | reuse-target clients |
| 3 | Electrowinning | Ion exchange | 250k | concentrated drag-out streams |
| 3 | Advanced oxidation | – | 220k | textile dyeing |
| 3 | MBR | UF | 280k | high-strength food, Standard A, small site |
| 4 | Vacuum evaporator | RO | 500k | zero-liquid-discharge clients |

## Tough clients (`src/game/variants.ts`)
- **Chance:** once a technology is researched, each new enquiry for a matching industry has a 40 % chance of being one of its variants.
- **Independent randomness:** a variant draws from its **own RNG stream** (`seed·7919 + 17`). The base enquiry for a seed (wastewater, standard, price draws) is identical with or without the variant system, so existing tests and saves keep their values.
- **Overlay:** the variant reshapes the true wastewater within documented ranges.
- **Pricing:** the job is priced from a reference design that uses the technology, × 1.15 tough-job premium (GAME MODEL).
- **Availability:** variants are registered with each technology's model; none exist before then.

## Customer names (`src/game/clientNames.ts`)
- **Generic names:** about 40 fictional names per industry (common Malaysian company-name parts).
- **No repeats in play:** a name already used by an open enquiry, a live project or an operated plant is skipped. The next unused name in the list is taken with no extra RNG draw, so only the name changes. If every name is in play, "(second site)" is appended.

## Contract requirements (`src/game/requirements.ts`)
Some tough clients set terms beyond the discharge standard. Each term is evaluated like a regulated parameter, with a value, a limit, pass/fail and a why-trace.
- **Where they appear:** the predicted result is shown in the Studio's compliance drawer, and the actual result on the commissioning report.
- **A failed requirement fails commissioning** even when the effluent meets the standard.

Requirements so far:
- `sludgeCapRMd`: sludge and waste disposal cost cap in RM/d (sludge dryer client). The cap is set at the reference design's disposal cost × 1.3.

Reuse fraction, ZLD and the green scorecard follow with RO, reclaim and the evaporator.


## Stage: remaining technologies (2026-11-22, simplified per user request)
All twelve technologies are now researchable. The models are deliberately simple; see each module's doc.

**Engine additions**
- Background TDS (`salinity_tds.md`).
- A liquid **reject** port (`ProcessResult.reject`) for RO brine, UF backwash, IX eluate and evaporator concentrate. An unpiped reject is costed as tankered liquid waste.
- Unit **credits** (metal sales, biogas power), netted off OPEX (`opexSplit.credit`).
- The **water reclaim system:** a disposal node with `params.reuse='yes'`. On-spec water (`standards.json → reuseSpec`) earns RM 3/m³.
- **ZLD:** the final discharge may have no inlet when a reclaim system exists.

**New contract terms (`requirements.ts`)**
- `reuseMin`: on-spec reuse ÷ influent.
- `zld`: discharge ≤ 0.5 % of influent.

**New tough clients**
| Variant | Needs | Feed | Terms | Reference design |
|---|---|---|---|---|
| `waterReuse` (plating) | RO + reclaim | TDS ×1.2–2 | Std B, ≥ 30 % reuse | metal train → GAC → 50 % split → UF → RO 75 %; brine and backwash blended back → pH 7.5 |
| `zld` (plating) | RO + reclaim + evaporator | – | Std A, ZLD | metal train → UF → RO 75 % → reclaim; brine → pH 6 → MVR 97 % → reclaim; concentrate → liquid haulage |

The base design fails both requirements. Both references pass on every generated feed tested.

**No dedicated client yet:** UF (pretreatment), IX and electrowinning (they pay by metal recovery), AOP (textile pending), UASB (POME pending), MBR.

**Still pending from the plan:** client tiers (medium/MNC with real names, green scorecard, fictional-names toggle), segregated second influent (drag-out → nickel-only evaporator), and the textile, POME and glove industries.

## Held review findings (2026-11-22) — to fix later, per user
Process review (wwtp-process-engineer):
1. HIGH Off-spec reuse water leaves without a compliance check (raw water to reclaim + empty discharge passes) — treat off-spec reuse as discharged or fail commissioning.
2. HIGH ZLD passes with an off-spec reclaim terminal — require reuse.m3d = onSpecM3d.
3. HIGH RO feed pressure < brine π at high recovery; no hard cap — P = max(π_avg+10, π_brine+3), cap ~41 bar.
4. HIGH Skipping UF before RO costs only +20 % energy — dirty feed raises CIP/replacement cost and degrades rejection above ~5 mg/L TSS.
5. MED UF at any flux keeps ≥ 75 % recovery — collapse recovery above ~2× design flux.
6. MED MBR flux > 30 LMH only warns — fouling penalty.
7. MED UASB X_S hydrolysis on a fixed 30 d SRT regardless of size/upflow.
8. MED UASB upflow > 1 m/h only warns — washout factor.
9. MED Biogas credit at retail tariff, no CHP O&M; opex can go negative.
10. MED MBR MLSS up to 18 g/L only costs energy — cap ~15 g/L or lose O2 transfer.
11. LOW RO scaling limit independent of sulfate/hardness.
12. LOW Evaporator feed > 270 g/L passes the 300 g/L cap via the recovery floor.
13. LOW Evaporator keeps CO2 / volatile acids in the concentrate.
14. LOW Reuse spec has no pH or metals limit.
15. LOW MBR α-ratio scales all AS energy, not just process air.

Chemistry review (industrial-chemist):
1. HIGH IX eluate Na double-counted (NaOH re-loads the eqD released to the water): eluate Cb = (naohEq − eqD − hclEq)/V; eluate should be ~pH 1, not 4.9.
2. HIGH Evaporator NH3 stripping not capped by alkalinity (concentrate reaches pH 1.2) — cap at acid-neutralising capacity or iterate on concentrate pH.
3. MED Evaporator CT non-volatile (CO2 should boil off).
4. MED Fenton utilisation independent of reaction time — × (1 − e^(−HRT/25 min)).
5. MED IX tiny bed at ~800 BV/h still removes 80 % — channelling above ~40 BV/h, regeneration-frequency limit.
6. MED RO CT rejection flat 0.6 — R_CT = 0.985·(1 − α0(pH)).
7. LOW-MED Electrowinning Ni pH gate uses feed pH, not pH after Cu plating.
8. LOW tdsTotal omits HCO3⁻ and counter-cations of tracked anions.
9. LOW IX Na-to-TDS is an exception to the "dosed salts not counted" rule — document.
10. LOW Fenton renames all coagulation chemicals "Iron catalyst" (display only).

Pre-existing, noticed in passing: base semiconductor/plating reference designs fail Standard A on some feeds; sulfide and sand filter share tag prefix "SF".
