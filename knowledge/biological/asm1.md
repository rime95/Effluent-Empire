# ASM1: Dynamic Activated Sludge (SCADA)

Module: `src/simulation/dynamic/asm1.ts`, used by `src/simulation/dynamic/plantDynamics.ts`.
Steady-state design still uses the Lawrence–McCarty model (`activated_sludge.md`). ASM1 is used only for the time-varying SCADA replay and for grab samples taken while an incident is active.

## Source
- Henze, Grady, Gujer, Marais & Matsuo (1987), *Activated Sludge Model No. 1*, IAWPRC Sci. Tech. Report 1.
- Alex et al. (2008), *Benchmark Simulation Model no. 1 (BSM1)*, Lund University, CODEN LUTEDX/(TEIE-7229)/1-62/(2008). The process rates are from §2.2.2, the conversion rates from §2.2.3, Tables 2–3, and the DO PI tuning from §5.2 / Appendix 5.

## States (mg/L)
| Symbol | Meaning |
|---|---|
| SS | readily biodegradable COD |
| XS | slowly biodegradable COD |
| XBH, XBA | heterotroph / autotroph biomass COD |
| XP | decay products |
| XI | particulate inert COD |
| SNH, SNO | NH₄-N, NO₃-N |
| SO | dissolved O₂ |
| XM | mineral solids (game addition; non-reactive) |
| Cb | strong-ion charge, eq/L (replaces S_ALK) |

## Processes (BSM1 numbering)
- ρ1 aerobic heterotroph growth: μH·SS/(KS+SS)·SO/(KOH+SO)·XBH
- ρ2 anoxic growth: μH·SS/(KS+SS)·KOH/(KOH+SO)·SNO/(KNO+SNO)·ηg·XBH
- ρ3 autotroph growth: μA·SNH/(KNH+SNH)·SO/(KOA+SO)·XBA
- ρ4, ρ5 decay: bH·XBH and bA·XBA (death–regeneration)
- ρ7 hydrolysis: kh·(XS/XBH)/(KX+XS/XBH)·[O-switch + ηh·anoxic switch]·XBH

Conversion rates follow §2.2.3, for example r_SO = −(1−YH)/YH·ρ1 − (4.57−YA)/YA·ρ3.

## Parameters — ✅ verified against BSM1 Tables 2–3 (Alex et al. 2008)
| Symbol | Value |
|---|---|
| YA | 0.24 |
| YH | 0.67 |
| fP | 0.08 |
| iXB | 0.08 |
| iXP | 0.06 |
| μH | 4.0 d⁻¹ |
| KS | 10 |
| KOH | 0.2 |
| KNO | 0.5 |
| bH | 0.3 d⁻¹ |
| ηg | 0.8 |
| ηh | 0.8 |
| kh | 3.0 |
| KX | 0.1 |
| μA | 0.5 d⁻¹ |
| KNH | 1.0 |
| bA | 0.05 d⁻¹ |
| KOA | 0.4 |
| ka | 0.05 (not used, see simplifications) |

The report says the set "corresponds approximately to a temperature of 15 °C", so **Tref = 15 °C**. Rates are corrected with Arrhenius θ from `microbial_kinetics.md`:

| Rate | θ |
|---|---|
| μH | 1.072 |
| bH | 1.12 |
| μA | 1.103 |
| bA | 1.04 |
| kh | 1.116 |

bH and kh come from the Henze et al. (1987) Table 6 20/10 °C pairs: bH 0.62/0.20 → 1.12 and kh 3.0/1.0 → 1.116 (biological review, 2026-11-21). The old 1.04 is the traditional-decay value, wrong for death–regeneration. At 28–32 °C, μH is ×2.5–3.3 and μA ×3.6–5.3 relative to 15 °C. 🟡 verify: all θ against Henze 1987 Table 6.

## Simplifications (GAME MODEL)
0. **Heterotroph NH₄ switch** SNH/(K_NH,H + SNH), K_NH,H = 0.05 mg N/L (ASM2d/ASM3 practice; not in ASM1/BSM1). Without it, N-deficient industrial feeds created biomass N from nothing (review 2026-11-21).
1. **Organic N not tracked.** SND, XND, ammonification (ρ6) and ρ8 are omitted. Decay releases (iXB − fP·iXP) of N as NH₄ immediately. Test "N balance closes" in `tests/simulation/dynamic.test.ts`.
2. **One CSTR per AS unit** rather than BSM1's five tanks. There is no internal nitrate recycle, so denitrification happens only where the DO is low.
3. **Effluent mapping.** XP leaves as inert particulate COD (no BOD, iXP), and only XBH + XBA count as active biomass.
4. **Mixed-liquor metals** are a CSTR state, so a toxic slug is diluted and then washes out instead of acting at inlet strength.
5. **Ideal clarifier.** The secondary clarifier is folded into the reactor. Effluent particulates = reactor concentration × carry fraction, from the Vesilind flux ratio (`sedimentation.md`). Wasting is set to hold the SRT set-point: Qw/V = 1/SRT − D·carry.
6. **Alkalinity as charge.** dCb = (dNH₄ − dNO₃)/14 007 eq/L. pH is re-solved each 15-min step from the charge balance in open-carbonate mode.
7. **Inhibition.** pH, metal and nitrifier-specific factors are reused from the steady model (`activatedSludge.ts`).

## Oxygen
- Saturation is from Benson & Krause (1984), APHA 4500-O: 20 °C → 9.09 mg/L, 30 °C → 7.56 mg/L (tested).
- kLa is limited to 1.6 × the design O₂ demand / (V·(Cs − DO)) and capped at 360 d⁻¹ (BSM1 Table 15).
- The DO PI controller uses the BSM1 default tuning K = 25 d⁻¹ per mg/L and Ti = 0.002 d, with conditional-integration anti-windup.
- Aeration energy uses the BSM1 relation AE = Cs·kLa·V/(1.8·1000) kWh/d.

## Numerics
SS, SO and SNH are stiff: ∂r/∂SS ≈ μH·XBH/(YH·KS) ≈ 10³–10⁴ d⁻¹ at MLSS 3–5 g/L.

**Decision (2026-11-21):** the first version used explicit Euler with 1-min steps. It overshot below zero and was clamped, so OUR read 0 while DO was still controlled. The fix:
- sub-step 20 s (`ASM1_SUBSTEP`);
- the model is written in Petersen form (process rates × stoichiometric matrix);
- each step applies whole stoichiometric vectors, so every linear invariant is conserved exactly;
- a process whose reactants would be over-drawn within the step is scaled back to what is available (process-limiting, in the spirit of modified-Patankar schemes; Burchard et al. 2003);
- OUR and kLa are reported as step means.

An interim exponential update was replaced after review because it conserved positivity but not mass.

Warm start: 4 × SRT at constant average load from a seeded biomass inventory, cached per design.

## Validation
- O₂ saturation reference values ✅.
- Electron and N balances are invariant both in the derivatives (anoxic case including N₂ at 1.71 g COD/g N) and in the integrated states of a stiff closed batch where O₂ runs out (tests).
- Reference food plant at diurnal load holds DO at set-point with OUR ≈ 30 mg/L·h and passes Standard B 100 % of the time.
- With the blower tripped (kLa → 0), DO drops to 0 within minutes and effluent NH₃-N/BOD rise past Standard B within hours.
- Not yet run: the BSM1 open-loop steady state (Appendix 4) as a regression. That needs the 5-tank layout and organic N, so it's planned only if the full BSM1 layout is added.
