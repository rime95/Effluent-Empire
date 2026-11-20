# Granular Activated Carbon (GAC) Adsorption

Module: `src/simulation/physical/carbon.ts`.

## Purpose in the game
Activated sludge cannot remove **inert soluble COD (S_I)**. Plating brighteners, surfactants and dyes often push effluent COD above 80 mg/L (Standard A) even after perfect biology. GAC adsorbs these refractory organics and is a polishing step.

## Model
**Equilibrium (Freundlich):** q = K_F · C^(1/n), with q in mg COD/g carbon and C in mg COD/L.
- GAME constants: K_F = 20, 1/n = 0.4, so q(100 mg/L) = 126 mg/g (tested).
- 🔴 COD is a lumped parameter. Real capacity must come from a site isotherm.

**Carbon usage rate** at exhaustion (bed in equilibrium with the influent):

    CUR (g carbon / L treated) = (C₀ − C_e) / q(C₀)

It is reported in kg/d and charged as replacement carbon (RM 9/kg, GAME price).

**Kinetics (GAME MODEL):** the adsorbable fraction removed is 1 − exp(−EBCT/τ), with τ = 4 min.
- EBCT 10–15 min is typical for dissolved organics. ✅ (design references)
- Adsorbable fractions: S_I 80 %, residual S_S 30 % (small polar molecules adsorb poorly), emulsified O&G 70 %.

**Fouling:** feed TSS above 20 mg/L blinds the bed, so efficiency is multiplied by 20/TSS. Put a sand filter upstream.

## Mass balance
Adsorbed COD and O&G leave with the spent carbon (`removed` stream) and are tested for closure.
