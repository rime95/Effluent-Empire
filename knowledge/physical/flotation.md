# Dissolved-air flotation (DAF)

Module: `src/simulation/physical/flotation.ts`. Advanced technology (Technology Tree tier 1).

## Principle
A part of the clarified effluent is recycled through a **saturator** at 350–600 kPa(g), where air dissolves (Henry's law). When it is released into the flotation tank at atmospheric pressure, micro-bubbles (30–100 µm) form and attach to oil droplets and floc. The flocs rise and are skimmed off as **float**, with heavy solids settling in a bottom hopper. DAF is the standard unit for **oily, greasy and light-floc** industrial wastewater: edible-oil refining, dairy, meat, food processing and metal-working fluids.

## Air-to-solids ratio (governing design parameter, Metcalf & Eddy)

    A/S = 1.3 · s_a · (f · P − 1) · R / (S_a · Q)        [mL air per mg solids]

| Symbol | Meaning | Value |
|---|---|---|
| 1.3 | density of air | mg/mL |
| s_a | air solubility at 1 atm | mL/L; 0 °C 29.2, 10 °C 22.8, 20 °C 18.7, 30 °C 15.7, 40 °C 14.2 (M&E). `verify:` |
| f | saturator efficiency | 0.8 (packed saturator; 0.5 unpacked). GAME MODEL, `verify:` |
| P | saturator pressure | atm absolute = (p_g + 101.3)/101.3 |
| R | recycle flow | m³/d |
| S_a | floatable solids in the feed | mg/L = TSS + total O&G |
| Q | feed flow | design at peak |

**Typical design values:**
- A/S 0.005–0.06 mL/mg, with 0.02–0.04 for oily wastewater;
- hydraulic loading (feed + recycle) 5–12 m/h;
- solids loading 2–10 kg/m²·h with chemical pre-treatment;
- recycle 15–50 %;
- float 2–5 % solids.

## Capture (GAME MODEL)

    η_i = φ_i · (1 − exp(−(A/S) / 0.008)) · h(HLR)
    h = 1 for HLR ≤ 10 m/h,  h = exp(−(HLR − 10) / 8) above

At A/S 0.02 the bubble term is 0.92; at 0.005 it is 0.46.

**Floatability φ (verify):**

| Material | φ | Note |
|---|---|---|
| Free and coagulation-broken oil | 0.98 | |
| Floc (Al, Fe, organic, precipitate, biomass) | 0.95 | |
| Mineral solids | 0.7 | |
| Grit | 0.8 | settles to the hopper |
| Colloids | 0.05 | |
| **Emulsified oil** | **0.10** | |

Stable emulsions (droplets below about 20 µm) do not attach to bubbles. They must be broken by **coagulation upstream** (acid cracking or coagulant + polymer), which turns them into free, floatable oil in the model (`coagulation.ts`).

## Energy and cost
- **Recycle pump:** kWh/d = R · Δp / (3600 · 0.65), plus 0.25 kW of scraper drive and air compressor.
- **CAPEX:** RM 250k for 10 m² (six-tenths rule) + RM 60k for the saturator package. GAME MODEL, `verify:`.
- **Float:** goes out the **sludge port** at 4 % solids, to the thickener, filter press or disposal.

## Validity and warnings
| Condition | Warning |
|---|---|
| A/S < 0.005 | too little air |
| A/S > 0.1 | wasted pumping energy |
| HLR > 12 m/h | bubbles swept out |
| SLR > 10 kg/m²·h | |
| Emulsified oil > 30 % of the oil | add coagulation upstream |

## Tough client opened (`variants.ts`: `emulsifiedOil`)
**Edible-oil refinery and food plant with emulsified oil.** The overlay raises total O&G to 200–500 mg/L with only 20–40 % free oil (oil is tracked separately from COD in the model). The reference design is EQ → coagulation (ferric at the jar-test optimum × 1.1, pH 7, polymer 1 mg/L) → DAF (60 % recycle, 550 kPa) → activated sludge (SRT 15 d, alkalinity held at pH 7) → clarifier → sand filter. It passes Standard B on every generated feed tested; the old gravity design never does. Standard B is forced: the Standard A O&G limit (1 mg/L) is not realistic for this feed.
