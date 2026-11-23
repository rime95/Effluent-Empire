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

## Auto-size and readouts (added 2026-11-24)
User feedback: the cell was hard to operate. The Studio inspector now has **Auto-size 80 / 90 / 95 %** buttons (`ewAutoSize`):
- area A = (1/(1−R) − 1)·Q/k_m (well-mixed cell, rounded up to 0.5 m²);
- current density j = metal equivalents to plate × n·F ÷ CE_max ÷ A × 1.3 margin, at least 5 A/m² (in dilute rinses this sits below the limiting current density, so little current goes to hydrogen).
New calculated readouts: nickel recovery %, nickel left in the liquor, limiting current density of the feed. The plated metal is sold automatically: the credit "Recovered metal sales" is netted from the plant OPEX (RM 70/kg Ni, RM 35/kg Cu, `verify:`).

Reference (tested), 20 m³/d rinse at 300 mg/L Ni, pH 4.5:

| Target | Area | Ni out | Ni sold | Net income | CAPEX | Simple payback |
|---|---|---|---|---|---|---|
| 80 % | 93 m² | 60 mg/L | 4.8 kg/d | RM 321/d | RM 0.36 M | 3.1 y |
| 85 % | 132 m² | 45 mg/L | 5.1 kg/d | RM 336/d | RM 0.44 M | 3.5 y |
| 90 % | 209 m² | 30 mg/L | 5.4 kg/d | RM 347/d | RM 0.56 M | 4.4 y |
| 95 % | 440 m² | 15 mg/L | 5.7 kg/d | RM 337/d | RM 0.86 M | 7.0 y |

Payback excludes the saved hydroxide sludge and precipitation chemicals, which improve it further. The spent rinse still goes to the main metal train; electrowinning is a recovery step, not the final polish.
