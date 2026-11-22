# Vacuum evaporator (MVR)

Module: `src/simulation/physical/evaporator.ts`. Technology Tree T4 (needs RO).

## GAME MODEL (`verify:`)
- **Water balance:** distillate = r·Q, concentrate = (1−r)·Q. All non-volatile species and all solids go to the concentrate.
- **Saturation cap:** concentrate TDS ≤ 300 g/L (crystallisation, pumpability). A higher requested recovery is cut back to r_max = 1 − TDS_f/300,000.
- **Ammonia carry-over:** free NH₃ fraction α = 1/(1+10^(8.3−pH)) (pKa at about 70 °C). 90 % of it goes to the distillate. The NH₄⁺ → NH₃ + H⁺ shift leaves the acid in the concentrate, which is automatic in the charge balance. Acidify to pH ≈ 6 first.
- **Volatile organics:** 2 % of soluble COD carries over.
- **Energy:** 25 kWh/m³ distillate + 0.05 kWh/m³ per g/L concentrate TDS (boiling-point rise raises the compression ratio). MVR is typically 20–40 kWh/m³.

**Warnings:** NH₃ carry-over, pH < 5 (chloride corrosion), oil > 50 mg/L (foaming), TSS > 500 mg/L.

**ZLD use:** brine → pH 6 → evaporator → distillate to reclaim; the concentrate (a few m³/d) goes to liquid haulage. A "nickel-only" evaporator on a segregated drag-out stream needs a second influent, which is not built yet.
