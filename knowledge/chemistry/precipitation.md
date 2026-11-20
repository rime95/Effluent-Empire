# Chemical (Hydroxide) Precipitation

Modules: `chemistry/neutralisation.ts` (the pH-adjustment unit and the precipitation reactor share this model) and `acidBase.ts` (`equilibrate`).

## Model
1. **Base demand** comes from charge balance to the set-point, including OH⁻ consumed by precipitation: ΔCb = requiredCb(pH_set) − Cb.
2. **Re-equilibration** follows every chemical change. Metals above solubility precipitate. Precipitates re-dissolve when under-saturated, e.g. after an acidic coagulant or the final pH correction lowers the pH.
3. **Precipitation is at equilibrium** (hydroxides form quickly). **Particle size is the kinetic part.** GAME MODEL pin-floc growth: v₅₀ = 0.05 + 0.25·(1 − e^(−HRT/20 min)) m/h.
4. **Unflocculated pin floc settles poorly.** Coagulation/flocculation raises v₅₀ towards the floc value.

## Mass accounting
- Metal total (dissolved + precipitated) is conserved through reactors.
- Hydroxide solid mass (TSS) = metal × MW(M(OH)₂)/MW(M).
- Total metal (dissolved + particulate) is compared with the discharge limit, as in a total-metals analysis.

## Design lessons the model teaches
- **Too low a pH leaves dissolved metal.** At pH 8, 12 mg/L Ni stays essentially fully soluble.
- **Acidic coagulants can undo precipitation.** Alum and FeCl₃ consume alkalinity and can drop the pH below the precipitation optimum. Use pH control in the flash-mix tank (the coagulation unit's `pHset`) or overshoot the reactor pH. The first reference-train run showed exactly this: PAC dropped pH 9.8 → 8.3 and re-dissolved 5 mg/L Ni.
- **Final neutralisation re-dissolves carried-over particulate metal.** Total metal is unchanged; it shifts to dissolved.
- **Separation, not chemistry, usually limits effluent metal:** coagulation → clarifier → sand filter.

## Reference train (tests/simulation/trains.test.ts)
EQ → precipitation pH 9.8 (NaOH) → coagulation FeCl₃ 75 mg/L with pH control 9.8 → clarifier (SOR ≈ 0.7 m/h avg) → sand filter → final pH 7.5.
It passes Standard B for plating seeds 1–5.
