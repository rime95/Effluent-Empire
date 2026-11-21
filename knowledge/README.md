# Effluent Empire — Engineering Knowledge Base

Read the matching document **before** editing a simulation module. Update the document when a model changes.
Verification status of every constant is tracked in **`VERIFICATION.md`** (last pass 2026-11-21). Values marked 🔴 there still need human confirmation against the reference book.

| Module | Documents |
|---|---|
| `core/units.ts`, `core/stream.ts`, `core/massBalance.ts` | this file, `design/design_parameters.md` |
| `chemistry/acidBase.ts`, `constants.ts` | `chemistry/acid_base_chemistry.md` |
| `chemistry/solubility.ts`, `neutralisation.ts` | `chemistry/solubility_product.md`, `chemistry/precipitation.md`, `chemistry/chemical_dosing.md` |
| `chemistry/coagulation.ts` | `chemistry/coagulation_flocculation.md` |
| `physical/settling.ts`, `physical/units.ts` | `physical/sedimentation.md`, `physical/filtration.md`, `design/design_parameters.md` |
| `biological/activatedSludge.ts` | `biological/activated_sludge.md`, `biological/microbial_kinetics.md`, `design/design_parameters.md` |
| `treatment/compliance.ts`, `regulations/standards.json` | `regulations/malaysia_environmental_quality.md` |
| `chemistry/chromiumReduction.ts` | `chemistry/chromium.md` |
| `physical/carbon.ts` | `physical/adsorption.md` |
| `game/operations.ts`, `game/staff.ts`, `game/market.ts` | `operations/om_model.md` |
| `dynamic/asm1.ts` | `biological/asm1.md` |
| `physical/sludge.ts`, sludge routing in `treatment/graph.ts` | `physical/sludge_thickening_dewatering.md` |
| recycles, splitter, mixer in `treatment/graph.ts` | `design/recycle_streams.md` |
| `dynamic/plantDynamics.ts`, `game/incidents.ts`, `ui/screens/Scada.tsx` | `operations/scada.md` |
| `treatment/catalogue.ts`, `game/industries.ts` | `processes/*.md` |

## Stream model
A stream stores **conserved totals**, so blending is linear and pH is always re-derived:
- `Q` m³/d, `peakFactor` (peak hourly / average), `T` °C, `pH` (cached result of the charge-balance solve)
- `Cb` eq/L: net strong ions (Σ strong cations − Σ strong anions), excluding H⁺, dissolved metals, chromate and **sulfate**. NH₄⁺ is counted here (valid below pH ≈ 8.5).
- `SO4T` mol/L: total sulfate, with the HSO₄⁻/SO₄²⁻ equilibrium (pKa₂ 1.99) in the charge balance. `CrVI` mg/L: chromate (HCrO₄⁻/CrO₄²⁻, pKa 6.51).
- `CT` mol/L: total inorganic carbon. `weakAcidT` mol/L with `weakAcidPKa`: volatile fatty acids.
- Metals `dissolved` / `precipitated` (mg/L as metal) for Ni, Cu, Zn. Coagulant solids `alSolid`, `feSolid` (mg/L as metal).
- COD fractions (mg COD/L), ASM-style:
  - `SS` readily biodegradable soluble
  - `SI` inert soluble
  - `XS` slowly biodegradable particulate
  - `XI` inert particulate
  - `biomass` mg VSS/L (COD = 1.42·VSS)
- O&G `OGfree`, `OGemulsified` (mg/L), tracked separately from the COD fractions (simplification).
- N: `NH4N`, `NO3N` mg N/L. Organic N is not modelled in Phase 1.
- Mineral solids: `grit`, `inert`, `colloid`, `floc` (destabilised colloid).
- Every solids pool has a median settling velocity `v50` (m/h) used by clarifiers, filters and separators.

Derived quantities:
- TSS = Σ pool masses
- COD = SS + SI + XS + XI + 1.42·biomass
- BOD₅ = 0.68·(SS + XS + 0.8·1.42·biomass), using BOD₅/BODu = 0.68 for k = 0.23 d⁻¹

## Mass balance (CLAUDE.md rule 5)
For every unit and for the whole plant, per component (Q, Ni, Cu, Zn, Al, Fe, COD, N, O&G, mineral solids), kg/d:

    in + produced = out + sludge + gas + consumed

- **produced:** coagulant Al/Fe dosed; lime impurities; COD fixed by autotrophic nitrifiers from CO₂.
- **consumed:** COD oxidised by O₂; biodegraded O&G.
- Sludge underflow water is neglected (< 1 % of Q). This is a Phase 1 simplification.
- Tolerance is 0.1 %. It is enforced by `tests/simulation/units.test.ts` (property test on random streams for every unit) and `trains.test.ts` (whole plants).

## GAME MODEL policy
Where no tractable mechanistic model exists, a semi-empirical model is used. It must:
1. be directionally correct;
2. stay bounded and physically plausible;
3. be documented here with its assumptions;
4. be marked `GAME MODEL` in code.
