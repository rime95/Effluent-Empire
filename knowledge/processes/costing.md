# Costing: CAPEX, OPEX and the client's budget (GAME MODEL, `verify:` against vendor budget prices)

## CAPEX
Each unit's equipment cost scales with its size by the six-tenths rule, `scale(ref, size, sizeRef) = ref·(size/sizeRef)^0.6` (`catalogue.ts`). On top of that:
- **Instruments and standby machines:** `instrumentation.ts`.
- **Chemical storage and dosing (added 2026-11-23).** `chemicalSystemCapex`: for every chemical a unit consumes, RM 45k at 100 kg/d of product, six-tenths rule, RM 8k minimum.
  - It covers bunded storage for ~14 days, duty/standby metering pumps, a day tank and pipework.
  - Large-flow, high-dose plants therefore pay for storage and pumping sized to the tonnes per day they dose. Examples: ferric for colloid-heavy CMP rinse, caustic for strong acid rinses, metabisulfite for chrome.
  - Before this, dosing units were costed on tank volume only, whatever the dose.
- **Jar-tested reference doses.** Reference designs dose coagulant at the jar-test optimum for the water reaching the coagulation tank × 1.1 (`referenceDesigns.ts → jarTested`). Job prices therefore carry the real chemical load.

## OPEX
- **Chemicals:** kg/d × price.
- **Energy:** kWh/d × RM 0.5.
- **Sludge:** wet tonnes to disposal at the gate price; unpiped sludge is costed at dry-solids rates.
- **Liquid haulage:** per m³.
- **Credits:** reuse, metal recovery and biogas power are subtracted.

All of these follow the feed: stronger wastewater means more chemicals and more sludge.

## Client budget
- **Contract value:** reference CAPEX × 1.35–1.6 market markup (× 1.25 for Standard A, × tier and tough-job factors).
- **Client OPEX allowance:** reference OPEX × 2.5–3.5 + RM 150/d (× tier factor). It was × 1.8–2.5 + 80 until 2026-11-23.
  - The lean reference carries no spare instruments, standby or safety margin, so real designs routinely exceeded the old allowance and lost reputation at commissioning.

## Influent strength (2026-11-23)
Raised toward typical raw industrial strengths (`industries.ts`; table in `technology_profiles.md`). The reference designs are now sized on the feed so they stay solvable:
- jar-tested coagulant;
- food aeration HRT = max(3 d, COD/1000 d) with alkalinity held at pH 7;
- semiconductor nitrification stage (NH₄-N now 15–45 mg/L, above the Std B limit).

Basic food oil stays mostly free (70–85 %). Emulsion-heavy food plants are the DAF client.
