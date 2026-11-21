# Constant Verification Log

Last pass: **2026-11-21**. Every engineering constant that was flagged `verify:` is listed here with its status.

| Status | Meaning |
|---|---|
| ✅ VERIFIED | Matched against a primary or critically reviewed source (gazette, IUPAC, NEA). |
| 🟡 CONSISTENT | Not found in a primary source, but secondary sources or a published behaviour check agree. |
| 🔴 UNVERIFIED | No accessible source confirmed it; the value still needs a human with the reference book. |

## 1. Malaysian discharge standards — `src/simulation/regulations/standards.json`
Source: **P.U.(A) 434/2009** gazetted text, Fifth and Seventh Schedules and Regulation 11 (FAOLEX copy: https://faolex.fao.org/docs/pdf/mal102817.pdf).

| Item | Game value | Gazette | Status |
|---|---|---|---|
| Temperature | 40 / 40 °C | 40 / 40 | ✅ |
| pH | 6.0–9.0 / 5.5–9.0 | same | ✅ |
| BOD₅ | 20 / 50 | same | ✅ |
| Suspended solids | 50 / 100 | same | ✅ |
| Copper, Nickel | 0.20 / 1.0 | same | ✅ |
| Zinc | 2.0 / 2.0 | 2.0 / 2.0 | ✅ (see conflict note) |
| Iron | 1.0 / 5.0 | same | ✅ |
| Aluminium | 10 / 15 | same | ✅ |
| Oil & grease | 1.0 / 10 | 1.0 / 10 | ✅ (see conflict note) |
| Ammoniacal N | 10 / 20 | same | ✅ |
| COD, other industries (7th Sch.) | 80 / 200 | same | ✅ |
| COD, textile / pulp mill / recycled paper / pulp+paper / fermentation | 80/250, 80/350, 80/250, 80/300, 400/400 | same | ✅ (added) |
| **Reg. 11(2) combined metals** | — (was missing) | ≥ 2 of Cu, Mn, Ni, Sn, Zn present → A: Σ ≤ 0.5; B: Σ ≤ 3.0 and soluble Σ ≤ 1.0 | ✅ **added and enforced** |

**Conflict note:** a widely circulated consultancy transcription of the Fifth Schedule (compliance.com.my, 2013) lists Zn 1.0 / 1.0 and O&G "ND" for Standard A. The gazetted P.U.(A) 434/2009 text gives Zn 2.0 / 2.0 and O&G 1.0 / 10. The game follows the gazette. Possible amendments after 2009 were **not** checked, so confirm with DOE Malaysia before real use.

Also from the gazette, not yet used by the game:
- First Schedule: premises discharging < 60 m³/d are exempt.
- Reg. 11(3): when phenol and free chlorine are both present under Standard B, phenol ≤ 0.2 and chlorine ≤ 1.
- Reg. 19 prohibits dilution.

## 2. Metal hydroxide equilibria — `src/simulation/chemistry/constants.ts`
| Constant | Game value | Source | Status |
|---|---|---|---|
| Zn: ε-Zn(OH)₂ log*Ks0 11.38 (log Ksp −16.62); *β₁…₄ −8.96, −17.82, −28.05, −40.41 | same | IUPAC, Powell et al. (2013) *Pure Appl. Chem.* 85:2249 | ✅ |
| Cu: *β₁ −7.95, *β₂ −16.2 | same | IUPAC, Powell et al. (2007) *Pure Appl. Chem.* 79:895 | ✅ |
| Cu: *β₃, *β₄ | **−26.9 → −26.60, −39.6 → −39.74** | same | ✅ corrected |
| Cu(OH)₂(s) log Ksp | −19.3 → −19.33 (log*Ks0 ≈ 8.67) | COST compilation of Powell 2007 (column alignment uncertain) | 🟡 |
| Ni: NiOH⁺ *β₁ | **−9.86 → −9.54 ± 0.14** | NEA review, Gamsjäger et al. (2005), as tabulated in Radiochim. Acta (ISA–Ni study) | ✅ corrected |
| Ni: Ni(OH)₃⁻ *β₃ | **−30 → −29.2 ± 1.7** | same | ✅ corrected |
| Ni: Ni(OH)₂(aq) | **removed** (was −19) | NEA does not select this species | ✅ corrected |
| Ni(OH)₂ fresh precipitate, log Ksp −15.2 (log*Ks0 12.8) | kept | no primary source found; NEA crystalline β-Ni(OH)₂ is log*Ks0 11.03 ± 0.28 (~60× less soluble) | 🔴 game choice (fresh solids are more soluble than aged crystals) |

Effect of the Ni correction: the model's Ni(OH)₂ solubility minimum moves from about pH 10.2 to about **pH 9.95**.

## 3. Acid–base constants — `constants.ts`
| Constant | Status |
|---|---|
| pKw, pK₁, pK₂, K_H(CO₂) regressions | 🟡 reproduce standard 25 °C values (13.995, 6.35, 10.33, −1.47) and literature values at 0 and 50 °C (independent numerical check by the chemistry review); primary regression papers not re-read |

## 4. Coagulation — `coagulation.ts`
| Constant | Status |
|---|---|
| Alum/FeCl₃ stoichiometry (0.505, 0.925 mg CaCO₃/mg; 0.262, 0.659 mg hydroxide/mg) | ✅ derived from molar masses, matches textbook 0.5 / 0.92 |
| Al(OH)₃(am) log*Ks0 10.8, aluminate log*K −12.1 | 🟡 model minimum ≈ 0.03 mg/L at pH 6.2. Published behaviour: alum minimum solubility at pH 6.0 (20 °C) and ≈ 2 µM (≈ 0.05 mg/L) minimum (IUPAC Al review). Exact constants not found. |
| PAC 9 % Al, basicity 0.70 | 🔴 typical product datasheet values, varies by supplier |
| Coagulant pH windows | 🔴 GAME MODEL ranges |

## 5. Biological — `activatedSludge.ts`
| Constant | Status |
|---|---|
| Heterotroph μmax 6.0, Y 0.45, b 0.12, fd 0.15 | 🟡 inside published ranges (μmax 2–10, Y 0.3–0.6, b 0.06–0.15 d⁻¹) |
| Heterotroph Ks 8 g bCOD/m³ (M&E 5th ed. per biological review) | 🔴 could not confirm the 5th-edition Table 8-14 online. Effect is small: effluent soluble bCOD changes by < 1 mg/L. |
| Nitrifier (AOB) μmax 0.90, Kn 0.50, b 0.17, θ values | 🔴 needs the M&E 5th-edition table |
| Nitrifier metal K_I (Cu 0.25, Ni 0.4, Zn 0.3 mg/L) | 🔴 US EPA Local Limits (2004) Appendix G could not be text-extracted. Values sit inside the ranges quoted by the biological review. |
| Field aeration efficiency 1.2 kg O₂/kWh | 🟡 fine-bubble clean-water SAE ≈ 4.3–6.1 kg O₂/kWh (vendor data, converted). Field values are lower by α·β·DO·T corrections, so 1.2 is deliberately conservative for industrial wastewater (low α). |
| Vesilind v₀ 6.5 m/h, k 0.34 L/g (Daigger & Roper 1985, SVI ≈ 110) | 🟡 the equation form is confirmed by later Daigger papers; the 1985 coefficients were not found online |

## 6. Dosing — `neutralisation.ts`
| Constant | Status |
|---|---|
| Molar masses, eq/mol | ✅ |
| Hydrated lime 90 % purity | 🔴 typical commercial grade |

## 7. Phase 2 additions (2026-11-21)
| Constant | Status |
|---|---|
| Gazette Cr(VI) 0.05/0.05, Cr(III) 0.20/1.0 mg/L | ✅ P.U.(A) 434/2009 Fifth Schedule |
| Na₂S₂O₅ demand 2.74 mg/mg Cr(VI) (theory); practice ≈ 2.8 + 1.5 H₂SO₄ | ✅ stoichiometry; Products Finishing |
| Reduction at pH 2–2.5, 15–20 min, ORP ≈ 250–280 mV | ✅ design references |
| Cr(VI) reduction rate law k = 1.5·10^−(pH−2) min⁻¹ | 🟡 GAME MODEL calibrated to the practice above |
| Cr(OH)₃(am) log*Ks0 9.76; CrOH²⁺ −3.57; Cr(OH)₂⁺ −9.84 | ✅ Rai et al. 1987 via ECHA / compilations |
| Cr(OH)₃(aq) −16.19; Cr(OH)₄⁻ −27.65 | 🔴 |
| HCrO₄⁻ pKa 6.51 | ✅ Tong & King 1953 / Martell & Smith (chemistry review) |
| HSO₄⁻ pKa₂ 1.99 (Martell & Smith) — sulfate now tracked; H₂SO₄ dose solved exactly | ✅ resolved 2026-11-21 (was a 14–33 % acid under-dose at pH 2.5–2) |
| GAC carbon usage | fixed 2026-11-21: was 1000× too low (unit error); now ≈ 0.7 kg/m³ for ~95 mg/L COD removed |
| GAC Freundlich K_F 20, 1/n 0.4 (lumped COD); τ 4 min | 🔴 GAME values — site isotherm needed |
| GAC EBCT 10–15 min typical | ✅ |
| Salaries, O&M fee formula, wear and breakdown rates | GAME MODEL (see operations/om_model.md) |
| ASM1 / BSM1 stoichiometric & kinetic set, Tref ≈ 15 °C | ✅ Alex et al. 2008 BSM1 report, Tables 2–3 (read 2026-11-21) |
| BSM1 DO PI tuning K 25 d⁻¹/(mg/L), Ti 0.002 d; kLa max 360 d⁻¹ | ✅ BSM1 §5, Table 15, Appendix 5 |
| O₂ saturation (Benson & Krause / APHA 4500-O) | ✅ 9.09 mg/L at 20 °C |
| ASM1 Arrhenius θ (μH 1.072, μA 1.103, bH 1.12, bA 1.04, kh 1.116) | 🟡 bH/kh from Henze 1987 Table 6 20/10 °C pairs; verify all against the report |
| Heterotroph NH₄ switch K_NH,H 0.05 mg N/L | 🟡 ASM2d/ASM3 typical; added for N-deficient industrial feeds |
| Incident rates, action costs, pH-loop tuning | GAME MODEL (see operations/scada.md) |
| Unaided hydroxide pin-floc v₅₀ ceiling 0.6 m/h, concentration half-saturation 30 mg/L | 🟡 GAME MODEL; check against unaided metal-hydroxide clarifier SOR ≈ 0.5 m/h |
| Anionic PAM optimum 1.0 mg/L, gain ×2.5, price RM 14/kg | 🟡 |
| Lamella η 0.8 at 55°, RM 450/m² plate | 🟡 |
| Underflow solids (clarifier 1 % / 0.8 % bio, oil sep 5 %, backwash 3 %) | 🟡 M&E ranges |
| Thickener SLR 20 / 30, HLR max 24 / 8, underflow 3 % / 2.5 % | 🟡 |
| Filter press cake 25/35 % (chemical), 20/28 % (bio), capture 97 %, polymer 3 kg/t, lime 20 % DS | 🟡 |
| Instrument CAPEX (pH loop 18k, DO loop 22k, level 6k, flow 12k, standby pump 9k / blower 35k RM) | 🟡 GAME MODEL |
| Disposal RM 0.18 / 0.06 per kg wet (balanced against contractor RM 1.2 / 0.3 per kg DS) | 🟡 both likely low |

## Still needs a human with the books
1. Metcalf & Eddy 5th ed. Table 8-14: heterotroph and nitrifier coefficients.
2. US EPA Local Limits (2004) Appendix G: nitrification inhibition by Cu, Ni, Zn.
3. A primary value for freshly precipitated Ni(OH)₂ solubility (e.g. Baes & Mesmer 1976).
4. DOE Malaysia: whether P.U.(A) 434/2009 has been amended since 2009 (Zn and O&G conflict above).
5. Rai et al. (1987) original tables: Cr(OH)₃(aq) and Cr(OH)₄⁻ hydrolysis constants.
