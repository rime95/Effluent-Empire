# Rapid Sand Filtration

Module: `src/simulation/physical/units.ts` (`filter`).

## Model
Iwasaki's depth-filtration law: dC/dL = −λC, so C/C₀ = exp(−λL).

The filter coefficient decreases with approach velocity because single-collector efficiency falls (Yao, Habibian & O'Melia 1971). GAME MODEL:

    λ = λ₀ · (5 / v_f)^0.7      v_f = filtration rate at peak flow, m/h

| Pool | λ₀ at 5 m/h (1/m) |
|---|---|
| grit | 6 |
| inert, floc, Al/Fe floc | 3–3.5 |
| biomass | 2.5 |
| particulate organics | 2 |
| metal hydroxide pin floc | 1.2, rising to 3.5 when flocculated |
| colloids (not destabilised) | 0.15 |
| free oil | 1.5 |
| emulsified oil | 0.3 |

At 5 m/h with a 1 m bed, floc removal is about 97 %.

## Limits and warnings
- A filtration rate above 12 m/h warns of breakthrough. Typical rapid sand filters run at 5–10 m/h.
- Feed TSS above 80 mg/L warns of short runs. Filters polish; they are not primary separators.
- Head loss, backwash cycles and run length are not simulated in Phase 1. Backwash pumping energy is lumped at 0.03 kWh/m³.
