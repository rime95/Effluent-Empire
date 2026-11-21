# Chemical (Hydroxide) Precipitation

Modules: `chemistry/neutralisation.ts` (the pH-adjustment unit and the precipitation reactor share this model) and `acidBase.ts` (`equilibrate`).

## Model
1. **Base demand** comes from charge balance to the set-point, including OH⁻ consumed by precipitation: ΔCb = requiredCb(pH_set) − Cb.
2. **Re-equilibration** follows every chemical change. Metals above solubility precipitate. Precipitates re-dissolve when under-saturated, e.g. after an acidic coagulant or the final pH correction lowers the pH.
3. **Precipitation is at equilibrium** (hydroxides form quickly). **Particle size is the kinetic part.** GAME MODEL unaided growth (revised 2026-11-22):

       v₅₀ = 0.05 + 0.55·(1 − e^(−HRT/20 min))·C/(C + 30 mg/L)   m/h

   - C is the concentration of all settleable collision partners: hydroxide + Fe/Al floc + mineral solids.
   - Growth needs reaction time and particle collisions. Orthokinetic collision frequency scales with particle number concentration (Smoluchowski), so a dilute precipitate stays as pin floc.
   - The ceiling is about 0.6 m/h. 🟡 verify against unaided metal-hydroxide clarifier design overflow rates of about 0.5 m/h.
   - The old curve (ceiling 0.3 m/h, no concentration effect) gave only about 15 % capture in a default precipitation → clarifier train.
4. **Unflocculated pin floc settles poorly.** Coagulation/flocculation raises v₅₀ towards the floc value.

## Mass accounting
- Metal total (dissolved + precipitated) is conserved through reactors.
- Hydroxide solid mass (TSS) = metal × MW(M(OH)₂)/MW(M).
- Total metal (dissolved + particulate) is compared with the discharge limit, as in a total-metals analysis.

## Design lessons the model teaches
- **Too low a pH leaves dissolved metal.** At pH 8, 12 mg/L Ni stays essentially fully soluble.
- **Acidic coagulants can undo precipitation.** Alum and FeCl₃ consume alkalinity and can drop the pH below the precipitation optimum. Use pH control in the flash-mix tank (the coagulation unit's `pHset`) or overshoot the reactor pH. The first reference-train run showed exactly this: PAC dropped pH 9.8 → 8.3 and re-dissolved 5 mg/L Ni.
- **Final neutralisation re-dissolves carried-over particulate metal.** Total metal is unchanged; it shifts to dissolved.
- **Separation, not chemistry, usually limits effluent metal:** coagulation (+ polymer) → clarifier (or lamella) → optional sand filter.
- **Diagnosis (2026-11-22, player report: "Ni stays the same after the clarifier"):**
  - precipitation → clarifier with default sizing captures only 20–60 % of the pin floc, so Ni stays high;
  - adding PAC without pH control dropped the pH from 9.5 to 8.3 and re-dissolved about 9 mg/L Ni, even though TSS fell to 5 mg/L.
  - Both now raise explicit notes: `clar.pinfloc` and `coag.redissolve.<metal>`.
  - The compliance explanation names the unit that re-dissolved the metal.

## Reference train (tests/simulation/trains.test.ts)
EQ → precipitation pH 9.8 (NaOH) → coagulation FeCl₃ 75 mg/L with pH control 9.8 → clarifier (SOR ≈ 0.7 m/h avg) → sand filter → final pH 7.5.
It passes Standard B for plating seeds 1–5.
