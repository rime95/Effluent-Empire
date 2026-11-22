# Salinity (TDS)

Module: `src/simulation/core/stream.ts` (`Stream.tds`, `tdsTotal`). Needed by RO, the evaporator and the reuse spec.

**TDS = background salts + tracked ions.**
- `Stream.tds` (mg/L) is the *background* salt the engine does not track as its own species: Na⁺, K⁺, Ca²⁺, Mg²⁺, Cl⁻, silica. It is conserved: blended, split and concentrated like any dissolved species, and it is a mass-balance component (`TDS`).
- `tdsTotal` adds sulfate (as SO₄), dissolved and complexed metals, Cr(VI), dissolved Al/Fe, NH₄⁺ (×18/14) and NO₃⁻ (×62/14).

**Influent:** a fixed figure per industry (GAME MODEL, `verify:`), with no random draw so existing seeds keep their wastewater. Plating 900, food 700, semiconductor 400 mg/L. The water-reuse client raises it 1.2–2×.

**Not modelled (GAME MODEL):** salt added by dosing (Na⁺ from NaOH, Cl⁻ from FeCl₃/HCl, Ca²⁺ from lime) is not added to `tds`. Typically this adds +100–400 mg/L in a chemical train. Exceptions: ion exchange adds the Na⁺ it releases, and its eluate carries the spent regenerant salt.

**Regulation:** Malaysian Standards A/B set no TDS limit. TDS only matters for the reuse spec (`standards.json → reuseSpec`: TDS ≤ 500 mg/L, a client spec, `verify:`).
