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

## Dilute nickel rinse (added 2026-11-23)
Real plants recover nickel from segregated bright-nickel rinses at a few hundred mg/L. The game supports this:
- **Limiting current density:** i_L = 2·F·k_m·C. At 300 mg/L Ni (5.1 mol/m³) with k_m = 1×10⁻⁵ m/s that is ≈ 10 A/m². The current-density range now goes down to 5 A/m²; it was 20. Above i_L the extra current only evolves hydrogen (low current efficiency, high kWh/kg).
- **Cathode area for recovery R:** A = (1/(1−R) − 1)·Q/k_m. About 4.6 m² per m³/d gives 80 %; about 6.6 m² per m³/d gives 85 %. Cathode area now goes up to 1,000 m².
- **Example:** 20 m³/d at 300 mg/L, 100 m², 15 A/m² recovers ≈ 81 % (4.9 kg/d Ni, ≈ RM 340/d at RM 70/kg) for ≈ 17 kWh/kg (≈ RM 9/kg power).
- **CAPEX:** cells, cathodes and anodes scale with cathode area (RM 80k at 10 m², six-tenths rule), plus the rectifier on the current (RM 40k at 2,000 A) and RM 40k fixed. Before this it scaled with current only, so a large cathode at low current density was almost free.
- **Client `niRinseRecovery`** (needs electrowinning):
  - **Feed:** a plating site whose bright-nickel rinse drains separately, 6–15 % of the flow, Ni 200–400 mg/L as sulfate, pH 4–5.
  - **Reference design:** EW sized for 85 % recovery at 0.7 × i_L, with the spent rinse sent to the main EQ.
  - **Alternative:** blending the rinse in and precipitating everything is allowed; it just sells nothing and makes more sludge.
- **Still a GAME MODEL simplification:** plate cathodes only. Real dilute-nickel cells often use high-surface cathodes (carbon felt, rotating cylinder) with far higher k_m·a. Plating acidifies the rinse (2 H⁺ per Ni); the Ni pH gate uses the feed pH (held finding).
