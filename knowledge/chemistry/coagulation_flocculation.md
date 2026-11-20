# Coagulation and Flocculation

Module: `src/simulation/chemistry/coagulation.ts`. The Laboratory jar test reuses the same function.

## Stoichiometry
Standard reactions (MWH *Water Treatment* Ch. 9; Metcalf & Eddy §6-3), all tested.

**Alum:** Al₂(SO₄)₃·14H₂O + 6HCO₃⁻ → 2Al(OH)₃(s) + 3SO₄²⁻ + 6CO₂ + 14H₂O
- Alkalinity consumed = 6 × 50.04 / 594.4 = **0.505 mg CaCO₃ per mg alum**
- Al(OH)₃ produced = 2 × 78.0 / 594.4 = **0.262 mg per mg alum**

**Ferric chloride:** FeCl₃ + 3HCO₃⁻ → Fe(OH)₃(s) + 3Cl⁻ + 3CO₂
- Alkalinity consumed = 3 × 50.04 / 162.2 = **0.925 mg CaCO₃ per mg FeCl₃**
- Fe(OH)₃ produced = 106.87 / 162.2 = **0.659 mg per mg FeCl₃**

**PAC** with basicity B: base consumed = 3(1 − B) eq per mol Al.

In charge-balance terms the coagulant lowers Cb by these equivalents. The CO₂ formed stays in C_T (closed tank), and the pH is re-solved.

**Aluminium solubility (aluminate):** Al(OH)₃(am) uses log*K_s0 = 10.8, giving [Al³⁺] = 10^(10.8 − 3pH), and log*K = −12.1 for Al(OH)₄⁻ relative to the solid, giving [Al(OH)₄⁻] = 10^(−12.1 + pH). Values are from MWH Ch. 9 and Stumm & Morgan Fig. 6.6 (verify).
- The solubility minimum is ≈ 0.03 mg/L at pH 6.2. Above pH ≈ 8.5, alum and PAC leave mg/L-level dissolved Al.
- The dissolved Al is tracked as `alDissolved` and counts towards the Al limit.
- Relative to the neutral solid, dissolved Al³⁺ adds +3 eq and aluminate −1 eq, so dosing alum at high pH consumes extra base.

Fe(III) is assumed fully precipitated between pH 4.5 and 10. Coagulant solids that escape separation count as total Al or Fe in the effluent (the Standard A Fe limit is 1.0 mg/L).

## Destabilisation (GAME MODEL)
Real coagulation depends on colloid surface charge (zeta potential), particle concentration, pH and mixing. There is no closed-form model, so a semi-empirical response reproduces the classic four zones (under-dose, charge neutralisation, restabilisation, sweep floc):

    x = (coagulant metal dose, mmol/L) / (optimum, mmol/L)
    E_cn(x) = (1 − e^(−3x)) · exp(−max(0, x − 1.2)²)
    E_sw(x) = 0.95 · (1 − e^(−max(0, x − 2.5)/1.5))
    E = max(E_cn, E_sw) · f_pH
    f_pH = 1 inside the pH window, Gaussian (σ = 0.8 pH units) outside

**Optimum metal dose (mmol/L)** = (0.02 + 0.004·colloid + 0.0015·precipitate + 0.002·particulate organics + 0.0005·emulsified O&G) / efficiency. All loads are in mg/L. It is calibrated so 100 mg/L of colloids needs about 125 mg/L alum, inside the typical 20–300 mg/L industrial range.

| Coagulant | pH window | Relative efficiency |
|---|---|---|
| Alum | 5.8–7.5 | 1.0 |
| FeCl₃ | 4.5–10.0 | 1.0 |
| PAC | 5.5–8.5 | 1.3 (pre-polymerised) |

verify: these windows are typical published operating ranges, not hard limits. Ferric's upper bound reflects its use alongside hydroxide precipitation at pH 9–10. Alum and PAC lose effectiveness above about pH 8.5 as aluminate forms.

The destabilised fraction E has these effects:
- E of the colloids moves into the floc pool.
- Precipitate and organic-particle v₅₀ shift towards the floc v₅₀.
- 70 % × E of the emulsified oil becomes free, separable oil.

Floc growth with flocculation time t: v₅₀,floc = 0.3 + 2.7·(1 − e^(−t/8 min)) m/h.

## Optional pH control
The `pHset` parameter trims the pH with NaOH or H₂SO₄ after coagulant dosing. This is the usual way to keep metals precipitated while dosing acidic coagulants.
