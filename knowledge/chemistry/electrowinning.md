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
- **Still a GAME MODEL simplification:** (plate-only until 2026-11-24, see "High-surface cathode"). Plating acidifies the rinse (2 H⁺ per Ni); the Ni pH gate uses the feed pH (held finding).

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

## High-surface cathode: rotating cylinder (added 2026-11-24)
Parameter **Cathode type** (`cathode`: `plate` | `rce`). The rotating cylinder electrode thins the diffusion layer by spinning the cathode, raising the mass-transfer coefficient; it is the usual compact cell for dilute rinses. GAME MODEL values, all `verify:`:
- k_m = 1×10⁻⁴ m/s (plate 1×10⁻⁵), so area for recovery R is a tenth: A = (1/(1−R) − 1)·Q/k_m; limiting current density 10× higher.
- Drive power 6 kWh/d per m² of cathode.
- Metal comes off as powder/flake: sold at 90 % of the cathode price.
- CAPEX of the cell part RM 200k at 10 m² (plate RM 80k), six-tenths rule; rectifier and fixed part unchanged.

Reference (tested), same 20 m³/d rinse at 300 mg/L Ni:

| Target | Cathode | Area | Net income | CAPEX | Payback |
|---|---|---|---|---|---|
| 80 % | plate | 93 m² | RM 321/d | RM 0.36 M | 3.1 y |
| 80 % | rotating | 9.5 m² | RM 265/d | RM 0.25 M | 2.5 y |
| 90 % | plate | 209 m² | RM 347/d | RM 0.56 M | 4.4 y |
| 90 % | rotating | 21 m² | RM 266/d | RM 0.37 M | 3.8 y |
| 95 % | plate | 440 m² | RM 337/d | RM 0.86 M | 7.0 y |
| 95 % | rotating | 44 m² | RM 212/d | RM 0.54 M | 7.0 y |

Rotating cylinders win on capital and footprint up to ~90 %; at 95 % the motor power eats the saving. Concentrated liquors (g/L) are already fast on plates — RCE buys little there.

## Which streams are worth it (added 2026-11-24)
Metal load decides it: **kg/d = flow (m³/d) × concentration (g/L)**. Sold at RM 70/kg Ni, a cell auto-sized for 85 % (tested, game prices):

| Stream | Ni load | Net income | CAPEX | Payback |
|---|---|---|---|---|
| 2 m³/d × 5 g/L (drag-out) | 10 kg/d | RM 580/d | RM 0.15 M | 0.7 y |
| 20 m³/d × 300 mg/L (segregated rinse) | 6 kg/d | RM 336/d | RM 0.29–0.44 M | 3–3.5 y |
| 0.18 m³/d × 4.7 g/L (small dump) | 0.85 kg/d | RM 51/d | RM 0.07 M | ~4 y |
| 5 m³/d × 300 mg/L | 1.5 kg/d | RM 84/d | RM 0.15–0.21 M | 6–7 y |
| 1 m³/d × 300 mg/L | 0.3 kg/d | RM 17/d | RM 0.1 M | 18 y |
| 100 m³/d × 50 mg/L (mixed rinse) | 5 kg/d | RM 208/d | RM 1.1 M | 14 y |

Rule of thumb: worth it at **≥ ~1 kg/d of metal and ≥ ~0.3 g/L**. Concentrated, low-flow liquors (drag-out, IX eluate) pay fastest; mixed rinses at tens of mg/L need huge cathodes and never pay. Savings on hydroxide sludge and precipitation chemicals come on top.

**Low current efficiency warning:** `ew.overcurrent` when the cell captures ≥ 70 % of the plateable metal but runs > 3× the current needed (small concentrated stream at default settings — lower j or Auto-size); otherwise `ew.dilute` (mass-transfer limited — lower j, add area, rotating cylinder).
