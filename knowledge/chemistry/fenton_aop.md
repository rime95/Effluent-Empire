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
