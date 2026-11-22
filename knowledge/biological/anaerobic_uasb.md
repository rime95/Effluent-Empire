# UASB anaerobic reactor

Module: `src/simulation/biological/uasb.ts`. Technology Tree T2.

## GAME MODEL (`verify:`)
- **Soluble substrate:** first-order in a mixed blanket, S_out = S_in/(1 + k·HRT), with k = 6 d⁻¹ at 35 °C and θ = 1.06. Floor 50 mg/L. VFA follow the same removal; half the CO₂ stays dissolved.
- **Particulate X_S:** hydrolysis k_h = 0.25 d⁻¹ on an SRT of about 30 d.
- **Overload:** above 15 kg COD/m³·d, k falls in proportion. Feed pH below 6.5 gives k × 0.3.
- **Yield:** 0.05 g VSS/g COD; NH₄ is taken for synthesis (0.124 g N/g VSS).
- **Methane:** 0.35 Nm³ CH₄/kg COD converted (STP), × (273 + T)/273 at the reactor temperature. The converted COD leaves as gas.
- **CHP:** 9.97 kWh/Nm³ CH₄ × 38 % electrical efficiency, credited at the electricity price.
- **Warnings:** upflow above 1 m/h (6 m deep reactor), T below 25 °C, oil above 100 mg/L, feed COD below 1,500 mg/L.
- **Not modelled:** sulfate reduction and H₂S, ammonification, and VFA/alkalinity souring dynamics.
- **No client yet:** POME is pending. In the meantime UASB pays through lower aeration power and the biogas credit on high-strength food waste.
