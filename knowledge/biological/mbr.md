# Membrane bioreactor (MBR)

Module: `src/simulation/biological/mbr.ts`. Technology Tree T3 (needs UF).

**Biology:** the activated-sludge model is reused under MLSS control, with the set-point at 8–12 g/L. The membranes retain every solid, so the permeate holds only dissolved species. Waste sludge leaves the sludge port at the MLSS concentration.

## GAME MODEL (`verify:`)
- **Aeration α-factor:** α = exp(−0.0879·MLSS[g/L]) (Krampe & Krauth 2003). Blower energy is scaled by α(3 g/L)/α(MLSS), about ×1.85 at 10 g/L.
- **Scour air:** SAD_m 0.3 Nm³/m²·h at 0.025 kWh/Nm³. Permeate pumping 0.05 kWh/m³.
- **Warnings:** flux above 30 LMH (design 15–25), MLSS above 14 g/L, oil above 50 mg/L.
- Clarifier-specific advice from the activated-sludge model is suppressed.
