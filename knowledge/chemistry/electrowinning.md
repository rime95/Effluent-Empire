# Electrowinning

Module: `src/simulation/chemistry/electrowinning.ts`. Technology Tree T3 (needs ion exchange).

## GAME MODEL (`verify:`)
- **Faraday:** m = CE·I·t·M/(n·F), with n = 2, I = j·A.
- **Mass-transfer limit** (well-mixed cell): C_out ≥ C_in/(1 + k_m·A/Q), with k_m = 1×10⁻⁵ m/s for plate cathodes. Copper plates first, then nickel with the remaining current; the rest of the current evolves H₂. Current efficiency therefore falls in dilute liquor. Example: Cu at 20 mg/L, 10 m², 200 A/m² gives under 30 %.
- **Nickel** does not plate below pH 3.
- **Anode O₂ evolution** releases 2 H⁺ per M²⁺. This is automatic: the metal cation leaves the charge balance.
- **Cell voltage:** 2.2 V (Cu), 3.5 V (Ni).
- **Plated metal** leaves the water as product (`consumed` term in the mass balance). It is sold at Cu RM 35/kg and Ni RM 70/kg (`verify:`, LME-linked), and the credit offsets OPEX.
- **Not modelled:** complexed metal plating, Zn.
