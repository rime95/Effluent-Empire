# Sulfide precipitation and complexed metals

Module: `src/simulation/chemistry/sulfide.ts`. Advanced technology (Technology Tree tier 2).

## Why sulfide
Metal sulfides are orders of magnitude less soluble than hydroxides, and their solubility barely depends on pH in the normal range. The practical reason plating shops use sulfide is **complexed metal**. Electroless-nickel baths and some copper baths contain chelating or complexing agents (citrate, lactate, gluconate, ammonia, EDTA) that keep the metal in solution at any pH. Hydroxide precipitation therefore cannot reach the limit. The very low solubility of NiS, CuS and ZnS pulls the metal off the ligand.

## Complexed metal in the stream model
`Stream.complexed[m]` is dissolved metal held by ligands, in mg/L as metal.
- It is **excluded from hydroxide equilibrium**: neither raising the pH nor any hydroxide unit removes it.
- It counts in total and soluble metal for compliance, and in the mass balance.
- It is carried with the water through blending and sludge splits, like any dissolved species.
- GAME MODEL simplification: its charge contribution is neglected (ligand charge varies).

## Sulfide dosing
Reagent: NaHS, dosed in mg/L as 100 % NaHS (MW 56.06), supplied as about 40 % solution. GAME MODEL price RM 3.5/kg active, `verify:`.

    M²⁺ + HS⁻ → MS(s) + H⁺          (1 mol S per mol Ni, Cu, Zn)

1. **Allocation order:** sulfide reacts in order of increasing solubility, CuS < ZnS < NiS. It takes each metal's free dissolved metal first, then its complexed metal. Complex breaking efficiency is 0.98 per pass with sulfide in excess (strong EDTA chelates resist; `verify:`).
2. **Residual dissolved metal** for a fully satisfied metal is Ksp/[S²⁻], with [S²⁻] = (excess S_T)·α₂(pH), pK₁(H₂S) 7.0 and pK₂ 13.9. In practice this is effectively zero; the limit is particle capture.

**Ksp at 25 °C (`verify:` against primary data; published values spread over decades):**

| Sulfide | Ksp |
|---|---|
| CuS | 6×10⁻³⁷ |
| ZnS (sphalerite) | 2×10⁻²⁵ |
| NiS (α) | 3×10⁻¹⁹ (sulfide-ion basis consistent with pK₂ 13.9) |

**Cr(III)** does not form a sulfide in water. It stays with the hydroxide chemistry.

**Charge balance:**
- The Na⁺ dosed adds to Cb.
- The metal removed leaves the metal charge balance.
- The H⁺ released follows automatically (net −1 eq per mol S consumed).
- **Excess sulfide** is assumed oxidised to sulfate downstream (aeration, ferric dosing) and added to SO₄ (GAME MODEL). This is acid-forming like the real oxidation (HS⁻ + 2 O₂ → SO₄²⁻ + H⁺) and keeps the sulfur in the mass balance. Sulfide is not tracked as an effluent parameter in this version.

## Particles
Freshly precipitated metal sulfide is **colloidal**, v₅₀ ≈ 0.05 m/h. A clarifier alone barely catches it, so coagulation and polymer flocculation are needed downstream (the coagulation unit shifts precipitate v₅₀ to the floc v₅₀). Sulfide-bound metal leaves with the precipitate pool into the sludge, using the MS molar mass.

## Safety and warnings
| Condition | Warning |
|---|---|
| Excess sulfide at pH < 8 | H₂S off-gas: fraction H₂S = [H⁺]/([H⁺] + K₁). Keep pH ≥ 8 and ventilate. |
| Dose > 1.5× stoichiometric | Wasted reagent; residual sulfide odour and toxicity |
| Under-dose | The least insoluble metal (Ni) stays in solution |

## Tough client opened (`variants.ts`: `complexedNi`)
**Electroless-nickel plater.**
- **Feed:** Ni 15–40 mg/L, of which 45–75 % is complexed. Standard B.
- **Why hydroxide fails:** the hydroxide reference train leaves the complexed Ni in solution, well above the 1.0 mg/L limit.
- **Reference design:** EQ → hydroxide precipitation pH 9.8 → sulfide (NaHS at 1.3× the complexed + residual metal demand) → ferric coagulation (pH held at 9.8) with polymer → clarifier → sand filter → pH adjustment.

## Review changes (industrial-chemist, 2026-11-22)
- **Charge on complex breaking (was a sign error).** Complexed metal carries no charge in the model, so the freed ligand is taken to keep the metal's former 2 equivalents as an anion: Cb −2 per mol broken. Net with the Na⁺ dosed: −1 eq/mol, which is acid released, as for free metal. Exact when the ligand stays deprotonated (pH above about 6.4 for citrate).
- **Hydroxide solids convert.**
  - Remaining sulfide converts existing M(OH)₂ (unstable against MS when HS⁻ is in excess), up to 50 % × (1 − e^(−t/20 min)) of it. GAME MODEL surface conversion.
  - M(OH)₂ + HS⁻ → MS + OH⁻ + H₂O releases OH⁻, so pH rises.
  - Sulfide dosed onto unclarified water therefore consumes extra NaHS.
- **Residual sulfide is a pollutant.**
  - `Stream.sulfideS` (mol/L S) is blended and split like sulfate.
  - It is regulated as **Sulphide 0.50 mg/L (Standards A and B, Fifth Schedule)**, now in `standards.json`.
  - Excess NaHS is pH-neutral (Na⁺ balanced by HS⁻).
  - **Ferric scavenges it:** 2 Fe³⁺ + 3 HS⁻ → 2 FeS + S⁰ + 3 H⁺, so ⅔ mol Fe and 1 H⁺ per mol S. The sulfur joins the mineral solids and the Fe stays in the iron balance.
  - **Activated sludge oxidises it to sulfate:** HS⁻ + 2 O₂ → SO₄²⁻ + H⁺.
  - **H₂S warning:** any unit leaving more than 0.5 mg/L at pH < 8 raises one.
- **Achievable residual for complexes:** 0.15 mg/L per metal, so stacking reactors no longer drives complexed metal to zero. EDTA chelates of Ni/Zn are **not** broken by sulfide (conditional log K ≈ 18). The model assumes the weak ligands of electroless baths; EDTA is not modelled.
- **Not modelled:**
  - Cr(VI) + HS⁻ (consumes about 1.5 mol S per Cr; reduce Cr(VI) first, as the reference design does);
  - NH₃ released from ammine complexes;
  - pK₁ temperature dependence (fixed at 7.0).

  Ksp values are unused; residuals are capture-limited. Modern pK₂ is 17–19, so a Ksp-based residual would need an HS⁻ basis.
- **Recycle solver and dynamic replay** now carry the complexed and sulfide metal maps.
