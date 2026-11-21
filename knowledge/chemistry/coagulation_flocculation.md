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

In charge-balance terms FeCl₃ and PAC lower Cb by the chloride they add (3 and 3(1 − B) eq per mol metal); alum adds 3 SO₄²⁻ per mol, tracked as `SO4T`. HCO₃⁻ + H⁺ → CO₂ converts bicarbonate to CO₂, so **C_T is unchanged** (closed tank) and only the alkalinity falls. The pH is then re-solved by charge balance.

**Coagulant hydroxide solubility** (`solubility.ts` `coagSolubility`, 25 °C). The coagulant metal is partitioned between fresh M(OH)₃(am) and dissolved species *inside the charge balance* (`acidBase.ts` `requiredCb` / `equilibrate`), exactly like Ni/Cu/Zn/Cr. Every unit that changes the pH therefore re-dissolves or re-precipitates it: aluminate formed at pH 9 re-precipitates when a later tank neutralises to pH 7, and the base this needs is counted.
- [M(OH)ₙ] = 10^(log*K_s0 + log*βₙ − (3 − n)·pH)
- Al(OH)₃(am): log*K_s0 = 10.8; AlOH²⁺ −4.97; Al(OH)₄⁻ −22.9. 🟡 verify (Stumm & Morgan 1996; Baes & Mesmer 1976). These are 25 °C values with no temperature correction. In cold water the pH of minimum Al solubility rises (≈ 6.2 at 25 °C → ≈ 6.7 at 5 °C, Pernitsky & Edzwald 2006); this is negligible at Malaysian 25–34 °C.
  - The solubility minimum is ≈ 0.04 mg/L at pH 6.2. Above pH ≈ 8.5 alum and PAC leave mg/L-level dissolved Al; below pH ≈ 5 Al³⁺/AlOH²⁺ dissolve.
  - Al(OH)₂⁺ and Al(OH)₃° are omitted. Their published constants scatter by more than one log unit, and taken at face value they put the minimum solubility of fresh floc well above the 0.05–0.2 mg/L residual Al seen after good alum coagulation.
- Fe(OH)₃(am): log*K_s0 = 3.2; FeOH²⁺ −2.19; Fe(OH)₂⁺ −5.67; Fe(OH)₄⁻ −21.6. 🟡 verify (Stumm & Morgan 1996). Fe(III) is effectively insoluble from pH ≈ 3 to 12 (0.9 mg/L at pH 3, 9 mg/L at pH 2.5), so it only dissolves when an overdose exceeds the alkalinity.
- Dissolved Al and Fe are tracked as `alDissolved` / `feDissolved`, make no floc (destabilisation is credited to the solid share only) and count towards the Al and Fe limits. Coagulant solids that escape separation also count as total Al or Fe (Standard A Fe limit 1.0 mg/L).
- An overdose beyond the alkalinity is buffered by the coagulant itself: the excess metal stays dissolved instead of releasing acid. Alum or PAC therefore bottoms out near pH 4.6–4.9 (Al³⁺ ⇌ Al(OH)₃ buffer); ferric goes on down to pH 2–2.5, because Fe(OH)₃ is far less soluble.

**Alkalinity reporting.** `alkalinity()` titrates the whole sample to pH 4.5, solids included (Standard Methods 2320 B: alkalinity samples are not filtered), which matches the lab's titration curve. `alkalinityFiltered()` titrates the solution phase only and is used to check coagulant stoichiometry, because fresh floc would otherwise dissolve on paper during the titration and be counted as alkalinity. Dissolved aluminate does still titrate (Al(OH)₄⁻ + 4H⁺ → Al³⁺), so the measured drop after PAC or alum at pH ≥ 7 is slightly below the stoichiometric value.

### pH after dosing — reference check (2026-11-21)
Independent hand calculation: closed carbonate system, C_T constant, alkalinity reduced by the stoichiometric equivalents, same pK₁/pK₂/pK_w (Harned & Davis / Plummer–Busenberg). The model (`coagulate()`) and the hand calculation agree within ±0.05 pH wherever the dose is below the alkalinity. Water at pH 7.5 with 100 mg/L CaCO₃ alkalinity, 25 °C:

| Dose | Model pH | Hand calc pH |
|---|---|---|
| Alum 25 / 100 mg/L | 6.99 / 6.29 | 7.01 / 6.29 |
| FeCl₃ 25 / 100 mg/L | 6.76 / 5.25 | 6.76 / 5.26 |
| PAC 25 / 100 / 300 mg/L | 7.27 / 6.93 / 6.37 | 7.31 / 6.94 / 6.38 |
| Alum 300 mg/L (alkalinity exceeded) | 4.80, 11 mg/L Al dissolved | 2.99 if all Al precipitated — not physical |
| FeCl₃ 300 mg/L (alkalinity exceeded) | 2.50, a few mg/L Fe dissolved | 2.45 |

The small offsets in the first three rows are the dissolved-Al charge and HSO₄⁻, which the hand calculation leaves out. Temperature changes the pH by < 0.03 between 25 and 30 °C. The coagulant hydroxide constants are 25 °C values, like the other hydroxides.

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

Floc growth with flocculation time t: v₅₀,floc = (0.3 + 2.7·(1 − e^(−t/8 min)))·(1 + 0.4·eff_poly) m/h.

## Polymer flocculant aid (anionic PAM) — GAME MODEL
- Bridging effectiveness: eff = r·e^(1−r), with r = dose / optimum and optimum 1.0 mg/L. It peaks at the optimum and falls when overdosed, because excess polymer re-stabilises and carries over.
  - 🟡 verify: an optimum of 0.5–2 mg/L for metal-hydroxide and coagulant floc.
- Floc v₅₀ reaches about 4.2 m/h at the optimum with full flocculation time. 🟡 verify: polymer-aided hydroxide and coagulant floc typically settles at 1.5–4 m/h. The first draft's gain of 1.5 (about 7.5 m/h) was cut after chemistry review.
- Polymer mass (about 1 mg/L) is neglected in the solids balance.
- Anionic polymer also bridges hydroxide precipitate directly, without needing charge neutralisation: 80 %·eff of the remaining gap to the floc v₅₀.
- Price RM 14/kg 🟡.

## Aluminium speciation (fixed 2026-11-22, chemistry review; moved into the charge balance 2026-11-21)
The pH and the dissolved Al(III) are solved together. At first the Al charge was folded into Cb inside `coagulate()` only, so later units neither re-precipitated the Al nor counted its charge. Since 2026-11-21, `requiredCb` computes it at every pH, for every unit.
- The earlier undamped fixed-point loop oscillated and left Al as solid where it should have dissolved: PAC 300 at pH 9.5 kept 27 mg/L as "floc".
- Destabilisation now credits only Al that is actually solid, so aluminate makes no floc.
- The flash-mix pH controller computes one exact net dose at its set-point (`adjustPH`), with the Al/Fe speciation at that pH already inside `requiredCb`.

## pH control order (fixed 2026-11-22)
The flash-mix pH trim is applied *after* Al speciation. Aluminate formation at high pH consumes alkalinity, so the controller trims and re-speciates until it holds its set-point.

Before this fix, PAC with a set-point of 9.5 drifted to pH 8.5 and re-dissolved Ni.

## Optional pH control
The `pHset` parameter trims the pH with NaOH or H₂SO₄ after coagulant dosing. This is the usual way to keep metals precipitated while dosing acidic coagulants.
