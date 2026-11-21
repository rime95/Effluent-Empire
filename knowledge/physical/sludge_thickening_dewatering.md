# Sludge Line: Draw-off, Thickening, Dewatering, Disposal

Modules: `src/simulation/physical/sludge.ts`, sludge routing in `src/simulation/treatment/graph.ts`.

## Sludge draw-off (sludge port)
Units that separate solids (clarifier, oil separator, sand filter, thickener, filter press) have a **sludge port**. The solids a unit removes (`removed`) leave through it as a real stream:

    Q_s = M_DS / (w_s · ρ_w)        M_DS = dry solids kg/d, w_s = solids mass fraction, ρ_w ≈ 1000 kg/m³

- The water in the sludge is taken from the unit's outlet, so Q_main = Q_out − Q_s.
- Dissolved species leave with that water at the outlet concentration.
- Particulates stay in the main stream at concentrations scaled by Q_out / Q_main.
- Water, dissolved and particulate mass are therefore all conserved.

Underflow solids fractions (GAME MODEL, 🟡 verify against M&E 5th ed. Ch. 13–14 ranges):

| Unit | w_s | Note |
|---|---|---|
| Clarifier (chemical / primary) | from the sludge make-up (below) | |
| Clarifier after activated sludge | Xr (RAS/WAS concentration) | RAS/WAS 0.5–1.5 % |
| Oil separator | 5 % | oily sludge and skimmed oil |
| Sand filter | backwash volume = 3 % of throughput | backwash 2–5 % |
| Thickener underflow | from the thickener model | |
| Filter press cake | from the press model | |

**Clarifier underflow by sludge make-up (2026-11-21).** A fixed 1 % made the underflow 2–5× too large whenever dense solids settled with the hydroxide (player report: "underflow flow is very high"). Each kind of settled solid now has a typical underflow concentration, and volumes add, so the mixture is the mass-weighted harmonic mean 1/w = Σ(mᵢ/M)/wᵢ:

| Settled solid | wᵢ | Typical range |
|---|---|---|
| Grit | 10 % | |
| Mineral (inert) solids | 6 % | |
| Natural floc | 3 % | |
| Colloids | 2 % | |
| Primary organic solids | 5 % | primary sludge 4–6 % |
| Metal hydroxide (NaOH precipitation) | 2 % | 1–3 % |
| Ferric floc | 1 % | 0.5–2 % |
| Alum/PAC floc | 0.8 % | 0.5–1.5 % |
| Biomass (no RAS) | 0.8 % | 0.5–1.5 % |
| Skimmed oil | 5 % | |

🟡 verify against M&E 5th ed. Ch. 13 and WEF MOP 8. The clarifier inspector shows the underflow solids and flow (Q_s = M_DS / w).

Q_s is still a real slurry flow, not just the precipitate mass: the clarifier collects *every* settled solid (influent grit and mineral solids, natural floc, organics, coagulant floc and the precipitate), and that sludge is 94–99 % water.

**Unconnected port (legacy):** the removed solids are hauled by a contractor at the old dry-solids price (metal RM 1.2/kg DS, other RM 0.3/kg DS). The water in the sludge is neglected. This keeps older designs and saves unchanged.

## Gravity thickener (`thickener`)
- Solids loading rate: SLR = M_DS / A (kg/m²·d).
- Sludge type is "biological" if biomass is more than 50 % of the solids, otherwise "chemical".

| Sludge | Design SLR | Underflow at or below design SLR |
|---|---|---|
| chemical / metal hydroxide | 20 kg/m²·d | 3.0 % |
| biological (WAS) | 30 kg/m²·d | 2.5 % |

🟡 verify. The M&E ranges are wide: chemical sludges about 10–50 kg/m²·d, WAS about 20–40 kg/m²·d.

Hydraulic loading is checked as well (process review): HLR = Q/A, with a maximum of about 24 m³/m²·d for chemical sludge and 8 for WAS (🟡). Above it, capture falls by 1/(1 + 0.5·(HLR/max − 1)²).

A thickener cannot make sludge thinner than its feed. If the computed underflow is at or below the feed concentration, it is set to 1.1 × feed and flagged.

GAME MODEL response to overload, with r = SLR / SLR_design:
- underflow w = w_design · min(1, 1/r)^0.4 (an overloaded thickener produces a thinner underflow);
- solids capture = 0.95 for r ≤ 1, otherwise 0.95 / (1 + 0.6·(r − 1)²).

Supernatant leaves on the main outlet and underflow on the sludge port.

**Solids-flux limit (2026-11-21, player report: clarifier underflow approaching half of Q).** The earlier capture law 0.95/(1+0.6(r−1)²) collapsed steeply under overload. With the supernatant returned to EQ, the escaping solids came back to the clarifier, raised the load further and snowballed until the clarifier underflow was 50–120 % of Q. A gravity thickener actually behaves as a flux-limited device: the underflow carries solids up to the limiting flux G_L·A and only the excess rises over the weir:

    capture = min(0.95, G_L·A / M_in)      G_L = 1.5 × design SLR   (GAME MODEL, 🟡 verify against an M&E solids-flux analysis)

A supernatant recycle can therefore only run away when the fresh solids alone exceed G_L·A, which is genuinely unworkable. When solids spill, the overload note is an error and gives the area needed, M/SLR. The default thickener area is now max(4, Q/8) m² rather than a fixed 10 m².

## Filter press (`filterPress`)
Conditioning is either polymer or lime.

| Sludge | Polymer cake | Lime cake |
|---|---|---|
| chemical / metal hydroxide | 25 % DS | 35 % DS |
| biological | 20 % DS | 28 % DS |

🟡 verify. Recessed-plate presses typically reach 20–40 % DS.

- **Capture:** 97 %.
- **Conditioning:**
  - polymer 3 kg/t DS (🟡 2–5 kg/t);
  - lime 20 % of DS (🟡 10–30 %), which adds to the cake mass.
- **Capacity:**
  - cake volume V_c = M_cake / (w_cake · 1200 kg/m³);
  - required chamber volume = V_c / cycles per day;
  - if the installed chamber volume is short, the press is overloaded: cake solids fall in proportion and capture falls to 90 %.
- **Energy:** 0.5 kWh per m³ of feed (🟡).
- **Dilute feed** lengthens filling, since there is more filtrate per batch. Effective cycles = cycles·min(1, √(feed solids / 3 %)) (GAME MODEL). Thicken first.
- **Not modelled:** lime raising the filtrate pH, and FeCl₃ + lime conditioning.
- Filtrate leaves on the main outlet and cake on the sludge port.

## Disposal (`disposal` terminal)
Sludge (or cake) sent to a disposal point is costed per **wet** tonne:
- metal hydroxide sludge is a scheduled waste (SW 204), RM 0.18/kg wet;
- other sludge RM 0.06/kg wet.

**Balance decision (2026-11-22, process review):** at RM 0.25/kg wet, cake barely beat the legacy contractor price. These two prices are set together so that dewatering is a real CAPEX-versus-OPEX choice. Real Malaysian SW 204 gate fees are probably higher than both; 🟡 verify and re-balance together.

🟡 Both are GAME MODEL gate prices.

Consequences, by design:
- Liquid sludge (1 %) sent straight to disposal costs about 18 RM/kg DS.
- Thickened sludge (3 %) costs about 6 RM/kg DS.
- Filter-press cake at 25–35 % costs about 0.5–0.7 RM/kg DS, cheaper than the contractor price of 1.2.

Dewatering is therefore a real CAPEX-versus-OPEX choice.

## Sludge stream flow
The sludge stream's Q represents mass/1000 (ρ ≈ 1000 kg/m³), so wet mass = Q·1000. Filter-press chamber sizing uses a cake density of 1200 kg/m³.

The draw-off is limited to between 10⁻⁶·Q and 0.95·Q, so solids always travel with the stream.

## Validation
A pipe carries sludge if it leaves a sludge port, or a mixer or splitter fed by sludge:
- sludge reaching the final discharge is rejected;
- treated water reaching a disposal point is rejected;
- sludge entering a treatment unit is warned.

## Mass balance
A connected sludge stream is a normal pipe. Only disposal points (and unconnected sludge ports) take mass out of the system, so the system balance is: in = effluent + disposal + unconnected sludge + gas/consumed − produced.
