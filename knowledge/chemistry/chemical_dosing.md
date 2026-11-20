# Chemical Dosing

Mass rate (kg/d) = Q (m³/d) × dose (mg/L) / 1000. For example, 250 m³/d × 100 mg/L = 25 kg/d (tested).

| Reagent | MW (g/mol) | eq/mol | Purity basis | Note |
|---|---|---|---|---|
| NaOH | 40.00 | 1 | 100 % (commercial 32–50 % solution) | |
| Ca(OH)₂ hydrated lime | 74.09 | 2 | 90 % (verify); the 10 % inert part becomes sludge | cheaper, more sludge |
| H₂SO₄ | 98.08 | 2 | 100 % (commercial 98 %) | |
| Alum Al₂(SO₄)₃·14H₂O | 594.4 | — | 100 % | 2 mol Al/mol |
| FeCl₃ | 162.2 | — | 100 % (commercial 40 % solution) | |
| PAC | — | — | 9 % Al w/w, basicity 0.70 (verify) | |

The dose follows from charge balance: mol reagent = |ΔCb| / (eq/mol).

**GAME MODEL simplification (lime):** lime is treated as a strong base plus 10 % inert solids. In reality, a lime dose to pH ≥ 9.5 in carbonate-bearing water precipitates CaCO₃ (log K_sp −8.48), and in sulfate-rich acid wastes it precipitates gypsum (log K_sp ≈ −4.6). Both increase sludge and change C_T and buffering. A CaCO₃ saturation check is planned.

Indicative prices (RM/kg) used for the OPEX display: NaOH 2.0, lime 0.8, H₂SO₄ 0.8, alum 1.2, FeCl₃ 1.8, PAC 2.0. These are a GAME MODEL; Phase 2 makes prices market-driven.
