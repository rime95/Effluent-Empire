# Ion exchange (chelating resin)

Module: `src/simulation/chemistry/ionExchange.ts`. Technology Tree T2.

An iminodiacetate resin in Na form, run lead–lag, polishes **free dissolved** Cu, Ni, Zn and Cr(III). Selectivity: Cu > Ni > Zn > Cr(III) ≫ Ca.

## GAME MODEL (`verify:`)
| Quantity | Model |
|---|---|
| Service rate | BV/h = (Q/24)/V_resin, design 8–20 |
| Operating capacity | 1.0 eq/L at 10 BV/h, −3 % per BV/h above, floor 0.5 |
| Leakage | 0.5 % × (BV/h ÷ 10), ×5 below pH 4, floor 0.01 mg/L per metal |
| Charge | 2 Na⁺ released per M²⁺ (3 per Cr³⁺): Cb rises, Na mass to TDS |
| Run length | capacity·V ÷ metal eq/h; at least one regeneration per week |
| Regeneration | HCl 2.5× and NaOH 1.5× the equivalents removed; 4 BV per cycle |

**Eluate:** all the metal plus the spent NaCl leave through the reject port at the regenerant volume (extra water, listed in `produced.Q`). It is a small, concentrated stream for electrowinning or liquid haulage.

**Passes untouched (warned):** complexed metal, particulate metal, and feeds above pH 8.5 where the metal is already hydroxide.

**Game role:** hydroxide precipitation already reaches Cu ≈ 0.01 mg/L in this engine, so IX has no compliance-only client. It earns through recovery: eluate → electrowinning → metal sales.
