# Fenton oxidation (AOP)

Module: `src/simulation/chemistry/fenton.ts`. Technology Tree T3.

**Sequence:** acidify to the pH set-point (H₂SO₄) → iron + H₂O₂ → neutralise to pH 7.5 (NaOH). The Fe(OH)₃ floc needs a clarifier downstream.

## GAME MODEL (`verify:` jar tests)
- **Stoichiometry:** 2.125 g H₂O₂ per g COD. 1 g COD = 1 g O₂, and H₂O₂ supplies 16/34 g O₂ per g.
- **Utilisation:** η = 0.6·exp(−((pH−3)/1.0)²)·min(1, Fe:H₂O₂ ÷ 0.1). Field utilisation is typically 30–60 %.
- **Selectivity:** •OH is non-selective. Oxidation is shared pro rata over soluble COD (S_S and S_I), capped at 90 % of it (oxalate and other intermediates resist). Oxidised COD is mineralised (`consumed`).
- **Iron:** modelled as ferric, dosed through the coagulation chemistry (FeCl₃-equivalent). Real Fenton doses FeSO₄; the counter-ion difference is ignored.
- **Not modelled:** the BOD/COD ratio increase from partial oxidation, colour, and residual H₂O₂ interference in the COD test (a note only).
- **No client yet:** the textile-dyeing industry that needs it is pending.

## Partial oxidation and floc removal (added 2026-11-26, user: full mineralisation made Fenton too expensive)
GAME MODEL, all `verify:` with jar tests:
- **Partial oxidation:** of the refractory COD (S_I) the radicals attack, 60 % (`partialFrac`) is only ring-opened into biodegradable S_S. That costs 0.25 g O₂ per g (`partialO2`); the rest is mineralised. A modest dose before activated sludge therefore turns refractory COD into food for the biology. This is the usual "pre-oxidise, then biology" design, at about 0.5–1 g H₂O₂ per g COD instead of about 3.5.
- **Iron-floc removal:** at neutralisation the Fe(OH)₃ floc adsorbs and enmeshes remaining S_I. Up to 0.5 g COD per g Fe, capped at 30 % of the S_I, moves to particulate X_I and leaves with the iron sludge in the downstream clarifier.
- **Display:** the coagulation step's pH-window and dissolved-iron warnings are no longer shown (dissolved iron at pH 3 is intended). Its chemicals keep their own names; only the ferric line reads "Iron catalyst (Fenton, as FeCl₃)".
- **Not tested yet** (user asked to skip): a mass-balance and dose-response test is still owed.

- **Selectivity (2026-11-26):** radicals are shared between S_S and S_I weighted 1 : 10 (`siSelectivity`). Rate constants of •OH with aromatics (about 10⁹–10¹⁰ M⁻¹s⁻¹) are far above those with acetate or sugars (about 10⁷–10⁸ M⁻¹s⁻¹), so pre-oxidation before biology is not wasted on biodegradable COD. `verify:`
