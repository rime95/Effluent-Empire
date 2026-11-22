# Thermal sludge dryer

Module: `src/simulation/physical/dryer.ts`. Advanced technology (Technology Tree tier 1).

## Principle
An indirect (paddle or disc) or belt dryer evaporates the moisture left in filter-press cake. Cake at 20–35 % dry solids (DS) leaves at 70–90 % DS as granules. The **tonnage of scheduled waste to haul falls by a factor of 3–4**, and for metal-hydroxide sludge (SW 204) disposal is the dominant running cost. The vapour is condensed and the condensate returned to the head of the works.

## Mass balance
| Quantity | Value |
|---|---|
| dry solids | D = Q·Σ(solids + oil)/1000, kg/d (unchanged, all leave in the product) |
| feed water | ≈ Q·1000 − D, kg/d (cake density taken as 1 t/m³) |
| product (wet) | D / DS_target, kg/d |
| water evaporated | W = Q·1000 − D/DS_target, kg/d (0 if the feed is already at or above the target) |

Product goes out the **sludge port** at DS_target. Condensate goes out the main outlet. GAME MODEL: dissolved species leave at the moisture concentration in both streams; the amount is negligible.

## Energy (heat balance)

    q = W · [h_fg + c_p·(100 − T_feed)] / η_th
    h_fg = 2.257 MJ/kg,  c_p = 4.19 kJ/kg·K,  η_th = 0.75 (indirect dryer, verify)

This is about **0.95 kWh_th per kg of water evaporated**, against the literature's 0.8–1.0 for indirect dryers. Auxiliary electricity (drive, fans, condenser) is 0.06 kWh/kg H₂O. Heat comes from LPG (LHV 12.8 kWh/kg; price GAME MODEL, `verify:`) and is costed as a fuel.

## Cost
- **CAPEX:** six-tenths rule on evaporation capacity, RM 650k at 100 kg H₂O/h (GAME MODEL, `verify:`).
- **Footprint:** 25 m² + 0.15 m² per kg/h.

## Warnings
- Feed below 15 % DS: dewater first; drying thin sludge costs about 4× more energy per tonne of solids.
- Target above 90 % DS: dust and self-heating (fire) risk in metal and organic granules.
- Target at or below the feed DS: nothing to evaporate.

## Tough client opened (`variants.ts`: `sludgeCap`)
**Heavy-metal finisher with a disposal-cost cap.**
- **Feed:** high-load plating rinse, Ni 25–60, Cu 10–35 and Zn 5–20 mg/L, so far more hydroxide sludge.
- **Contract term:** sludge disposal cost must stay at or below a cap. The cap is set from the reference design with a thickener, filter press and dryer, × 1.3.
- **Why the dryer:** a plant without drying exceeds the cap, because cake at about 25 % DS costs roughly 3× more to haul than granules at 80 %.
- **Evaluation:** the cap is a contract requirement, checked at commissioning alongside the discharge standard (`src/game/requirements.ts`).
