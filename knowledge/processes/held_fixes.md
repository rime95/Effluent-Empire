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
(filled in by the review of the tier/dev-mode stage)

## Done
(none yet)
