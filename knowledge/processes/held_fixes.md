# Held fixes and exploits (single list)
Everything found in reviews or noticed in passing that the user has asked to **fix later**. Add new items here; tick them off (move to "Done") when fixed.

Severity: HIGH = exploit or clearly wrong result a player will hit; MED = model gap; LOW = polish.

## A. Advanced-technology stage (2026-11-22)
### Process review (wwtp-process-engineer)
Items 1–4 are **exploits**: they let a player pass the reuse/ZLD clients without real treatment.
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

### Chemistry review (industrial-chemist)
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

## B. Pre-existing, noticed in passing
1. MED Base semiconductor and plating reference trains fail Standard A on some generated feeds (pricing is still based on them).
2. LOW Tag prefix "SF" is used for both the sulfide reactor and the sand filter.

## C. Client tiers stage
QA review (qa-engineer), 2026-11-22. Two items fixed at once because they could mark a real save DEV or broke the dev tool (see Done).
1. MED Dev “Load reference design” rebuilds the tier design from current tech, not the tech at pricing — can swap ZLD/reuse vs the contract. Pick the candidate from e.requirements (or store the split on the enquiry).
2. MED Balance: medium tier pays ×1.8 (×1.25 more with Std A) for only a standby requirement (~RM 9k/pump) — about 2.25× a basic job for little extra work. Lower the multiplier or add a second medium term (sludge cap, instrument level).
3. MED Forced dev spawn skips tier eligibility: an MNC can spawn without RO/UF/reclaim researched (unbuildable). Fall back to medium when not eligible.
4. LOW reuseMin formula hardcodes UF 0.92 / RO 0.75 recovery — read from defaultParams so catalogue changes don’t silently demote MNC jobs.
5. LOW Forcing a variant and a tier together mixes them — make them mutually exclusive.
6. LOW Dev spawn consumes a seed: shifts the market RNG, candidates and refill from then on — give spawns their own counter, or document.
7. LOW Dev “Load reference design” allowed on a failed (built) project = free redesign — allow design status only.
8. LOW Alias prefixes cycle at 15 names — a longer list gives duplicate aliases; add a guard test.
9. LOW Performance: a tier enquiry runs up to 5 full simulations in refill — memoise or cap.
10. LOW Wrap remaining free-text spots (Scada alarm text, Studio result text, TechTree) in brand() for future-proofing.
11. LOW Test gaps: fuller determinism assertions (deadline, declared, hidden, name index), golden snapshot of pre-change enquiries, unique ids after spawn + refill, brandText idempotence / multiple names, missingStandby only on applicable units, MNC without evaporator never ZLD, neutral-wording message test, build ALL from TECH_ORDER.

## D. Segregated streams stage (2026-11-22)
Process review (wwtp-process-engineer). Nothing blocking.
1. MED EN stream COD (150–400 mg/L) is not tied to Ni. Lactate/citrate is about 4–6 g COD per g Ni, so 1,200–1,800 mg/L at 300 mg/L Ni. Fix: en.SS = ni × 4–6, then re-check COD under Std B, since the metal train removes little COD.
2. MED Drag-out SO4T is fixed at 0.06 M while Ni + Cu spans 39–167 mM, so setCbForPH closes the charge balance with implied chloride. Fix: SO4T ≈ 0.8 × metal eq + acid, remainder chloride (Watts bath).
3. LOW The UASB feed is only neutralised to pH 7 (about 50 mg/L alkalinity). A real 15–40 g/L sugar feed sours. Fix: add bicarbonate or effluent recycle once UASB alkalinity is modelled.
4. LOW A single drag-out carrying both Ni and Cu at pH 2–3 is unusual: lines are normally separate, and Ni electrowinning prefers pH 3.5–4.5. Fix: make it Ni-only, or mark it as a GAME MODEL simplification.
5. LOW NH₄-N at 1 % of COD is high for syrup or sugar reject, which are N-deficient. Fix: range(0.003, 0.01).
6. LOW segregatedGraph silently joins at u0 if the join kind is missing from the main train. Fix: throw.
7. LOW graph.noFlow tests the main Q only. Fix: use totalQ.
8. LOW The dynamic EQ pump target is total plant inflow. An EQ that sits only on a side stream (a player design) would get the wrong target. Fix: use that EQ's own steady inflow scaled by today's growth (this changes legacy dynamics for plants with filtrate returns, so it needs its own test pass).
9. LOW The Studio stream table and commissioning report list the main inlet only; side inlets appear only through their own pipes.

## E. Stronger influents and costing (2026-11-23)
Process review (wwtp-process-engineer).
1. HIGH Reference trains have no sludge line (thickener + filter press), so tender prices never include dewatering CAPEX (~RM 0.5–1 M+ for ~1 t DS/d). Fix: sludgeLineGraph on every REFERENCE train, thickener 20 (chemical) / 30 (bio) kg/m²·d, press volume = dry kg/d ÷ (cycles × ~300 kg DS/m³).
2. HIGH Sludge disposal prices are well below Malaysian scheduled-waste rates: metal wet RM 0.18/kg vs ~RM 0.8–1.5/kg (SW204 incl. transport); unrouted metal dry RM 1.2/kg DS; bio sludge 2–3× low. Fix: metal wet ~1.0–1.2, metal dry ~4.5/kg DS; other wet ~0.15–0.25, other dry ~1.0/kg DS (verify against quotes).
3. MED chemicalSystemCapex sizes on 100 %-active kg/d; supplied strengths (FeCl₃ ~40 %, NaOH 32–50 %, NaHS ~40 %) make tanks 2–2.5× larger → add supplyStrength per chemical.
4. MED Storage costed per unit, not per chemical: one plant-wide bulk tank per chemical + ~RM 10k per dosing point.
5. MED RM 8k minimum too low (dosing skid ~RM 15–25k; polymer make-up unit RM 30–60k).
6. LOW Double-counting: AS alkali day tank RM 35k and the standby-instrument pump overlap chemicalSystemCapex.
7. LOW Non-dosed consumables (GAC, LPG, CIP) also attract dosing CAPEX → dosed:false flag.
8. LOW Fluoride not modelled (semiconductor HF: 50–500 mg/L; EQIE A 2 / B 5, verify) — later phase.
9. LOW Chemical clarifier has no solids-loading check; scraper/underflow cost not scaled with dry kg/d.
10. LOW Semiconductor reference feeds pH 9.5 water straight to aeration — insert neutralisation to 7.5 first.
11. LOW DAF-train ferric dose computed on the raw stream, not jar-tested at the coagulation inlet; HRT floor 3.5 vs 3 d.
12. LOW Ranges: plating TDS 900 low (1,000–5,000 typical, matters for RO/ZLD); food N all as NH₄ (no organic-N pool, conservative — document); semiconductor Cu 10–40 is segregated-CMP-like, combined fab effluent is 1–10 — document as the "stronger" setting.

## Done
- 2026-11-23, user decision: random equipment breakdowns and process incidents are OFF (`OM.randomFailures = false`) — they drove reputation to −36 and made O&M unplayable. Loaded saves drop any active breakdown/incident. The machinery (BREAKDOWNS, incidents.ts, SCADA field actions) is kept for a possible opt-in setting. Note: the maintenance budget now only sets equipment condition, which no longer triggers anything.
- B1 (2026-11-23): base reference trains could not reach Standard A, so early Std A jobs (e.g. food O&G 1 mg/L) were unwinnable with the basic kit. Plain jobs now offer Standard A only where `REFERENCE_STD_A` (basic units + polishing / nitrification) meets it on the feed — about 100 % semiconductor, 60 % plating, 40 % food feeds — and are priced on that design; the rest are Standard B. Tier-1 research needs no reputation; low reputation recovers +1 every 2 weeks up to 30 while no plant fails a sample. The Studio has a design-margin check at end-of-contract flow (+30 %) with +8 % load.
- Reg. 11(2) combined metals: measure() summed every tracked metal including chromium; it now sums only the listed metals that are modelled (Cu, Ni, Zn — `COMBINED_METALS`). The rule trigger already ignored Cr. Regression test in edge.test.ts.
- Segregated streams: the SCADA replay scaled production growth on the main stream only. Now it scales every inlet.
- Segregated streams: the dynamic EQ pumped out at the main-stream flow only, so side-stream water accumulated until the tank overflowed (found in the browser check). It now pumps the total inflow. Regression test added; single-stream plants are unchanged.
- Segregated streams: the chrome, EN and drag-out reference trains are now sized on total flow.
- Dev mode leaked into a new game / older loaded save (Zustand merge kept devMode/devUsed) — initial() and migrate now reset both. Regression test in devMode.test.ts.
- Dev spawn with “Local SME” still rolled a random tier — force.tier 'basic' now skips the draw. Regression test.
