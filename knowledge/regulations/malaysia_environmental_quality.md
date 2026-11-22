# Malaysia — Environmental Quality (Industrial Effluent) Regulations 2009

Data file: `src/simulation/regulations/standards.json` (versioned). **Never hardcode limits elsewhere.**

- **Fifth Schedule:** acceptable conditions for discharge of industrial effluent.
  - **Standard A:** discharge upstream of any raw water intake.
  - **Standard B:** discharge downstream of any raw water intake.
- **Seventh Schedule:** COD limits that depend on the trade or industry.

## Parameters used in Phase 1 — ✅ verified against the gazetted P.U.(A) 434/2009 text (2026-11-21; see `../VERIFICATION.md`)
| Parameter | Standard A | Standard B |
|---|---|---|
| Temperature (°C) | 40 | 40 |
| pH | 6.0–9.0 | 5.5–9.0 |
| BOD₅ at 20 °C (mg/L) | 20 | 50 |
| Suspended solids (mg/L) | 50 | 100 |
| Oil & grease (mg/L) | 1.0 | 10 |
| Ammoniacal nitrogen (mg/L) | 10 | 20 |
| Nickel (mg/L) | 0.20 | 1.0 |
| Copper (mg/L) | 0.20 | 1.0 |
| Zinc (mg/L) | 2.0 | 2.0 |
| Aluminium (mg/L) | 10 | 15 |
| Iron (mg/L) | 1.0 | 5.0 |
| COD (default trades; Seventh Schedule) | 80 | 200 |
| COD (textile; Seventh Schedule) | 80 | 250 |
| COD (pulp mill / recycled paper mill / pulp and paper mill) | 80 | 350 / 250 / 300 |
| COD (fermentation and distillery) | 400 | 400 |

## Regulation 11(2): combined metals (enforced)
Where **two or more** of Cu, Mn, Ni, Sn and Zn are present:
- Standard A: total ≤ **0.5 mg/L**.
- Standard B: total ≤ **3.0 mg/L** and soluble total ≤ **1.0 mg/L**.

A plating effluent can pass every individual metal limit and still fail this rule. The game evaluates it as the `MetalsTotal` and `MetalsSoluble` checks whenever more than 0.01 mg/L of two or more of these metals is present. Only the listed metals count in the sums (Cu, Ni, Zn in the model — `COMBINED_METALS`); chromium is excluded (fixed 2026-11-22: it had been included in the sums).

**Source conflict:** a consultancy transcription (compliance.com.my) lists Zn 1.0/1.0 and O&G "ND" for Standard A. The gazette gives Zn 2.0/2.0 and O&G 1.0/10, and the game follows the gazette. Amendments after 2009 have not been checked.

The full schedules include more parameters: Hg, Cd, Cr(VI), Cr(III), As, CN, Pb, Mn, Sn, B, Ag, Se, Ba, F, formaldehyde, phenol, free chlorine, sulphide and colour. These will be added to `standards.json` as the game models them.

## Compliance rules in the game
- **Every parameter is evaluated independently.** Passing COD or BOD never implies overall compliance.
- **Metals are compared as total** (dissolved + particulate), matching a total-metals analysis. The Reg. 11(2) soluble limit uses the dissolved fraction only.
- Exemptions (First Schedule) and the phenol/chlorine rule (Reg. 11(3)) are not used yet.
- **Each check carries an explanation trace** (`treatment/compliance.ts`) describing which mechanism limits it.
