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

Caveats (process review):
- The metal hydroxide value assumes NaOH precipitation. Lime precipitation co-precipitates CaSO₄/CaCO₃, which sit in the mineral (`inert`) pool at 6 %, so a lime sludge correctly comes out thicker (3–5 %).
- Additive volumes are conservative: dense solids actually help compact hydroxide floc a little.

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
- solids capture: superseded by the solids-flux limit below.

Supernatant leaves on the main outlet and underflow on the sludge port.

**Solids-flux limit (2026-11-21, player report: clarifier underflow approaching half of Q).** The earlier capture law 0.95/(1+0.6(r−1)²) collapsed steeply under overload. With the supernatant returned to EQ, the escaping solids came back to the clarifier, raised the load further and snowballed until the clarifier underflow was 50–120 % of Q. A gravity thickener actually behaves as a flux-limited device: the underflow carries solids up to the limiting flux G_L·A and only the excess rises over the weir:

    capture = min(0.9995, G_L·A / M_in)      G_L = 1.5 × design SLR   (GAME MODEL, 🟡 verify against an M&E solids-flux analysis)

Normal capture was raised from 0.95 to 0.9995 (2026-11-21, practitioner rule: a correctly loaded thickener returns a clear supernatant, ≈ 40 mg/L in the plating reference). This assumes good operation and polymer aid where needed; 🟡 verify. Solids pass only when the thickener is over its flux limit or its hydraulic loading.

A supernatant recycle can therefore only run away when the fresh solids alone exceed G_L·A, which is genuinely unworkable. When solids spill, the overload note is an error and gives the area needed, M/SLR. The default thickener area is now max(4, Q/8) m² rather than a fixed 10 m².

**Holding-tank operation (`mode: 'holding'`, 2026-11-21, practitioner input).** At many small metal-finishing plants the "thickener" is run as a sludge holding tank. Nothing is decanted: the whole feed goes on to the filter press, and the outlet to EQ is only an emergency overflow. In this mode the model:
- passes the full feed (water and all solids) out of the sludge port, with no thickening, so the press sees the clarifier underflow concentration;
- carries nothing on the main outlet in steady state (an upset overflow is not modelled);
- still uses the area parameter for CAPEX and footprint, and shows a holding time at 3 m depth.

The trade-off is a clear return and no solids loop, at the cost of a thinner press feed: fewer effective cycles, so a larger press.

## Filter press (`filterPress`)
Conditioning is either polymer or lime.

| Sludge | Polymer cake | Lime cake |
|---|---|---|
| chemical / metal hydroxide | 25 % DS | 35 % DS |
| biological | 20 % DS | 28 % DS |

🟡 verify. Recessed-plate presses typically reach 20–40 % DS.

- **Conditioning:**
  - polymer 3 kg/t DS (🟡 2–5 kg/t);
  - lime 20 % of DS (🟡 10–30 %), which adds to the cake mass.
- **Capacity:**
  - cake volume V_c = M_cake / (w_cake · 1200 kg/m³);
  - required chamber volume = V_c / cycles per day;
  - normal solids capture is 99.9 %, so the filtrate is practically solids-free (≈ 10–30 mg/L for a 1–3 % feed). This was raised from 97 % on practitioner input: a conditioned feed on cloths in good order gives a clear filtrate. 🟡 verify against M&E Table 18 (filter press capture 90–98 %+).
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
- sludge entering a treatment unit is warned;
- a thickener in holding mode with no sludge pipe is warned (`graph.holdingNoSludge`): without one, everything leaves through its outlet;
- a unit with no pipes at all is left out of the calculation and of CAPEX and construction time, with a warning (`graph.loose`), so one spare unit on the sheet does not blank the whole design. A half-connected unit is still an error, because its flow would have nowhere to go.

The thickener overload note mentions spilled solids only when the load exceeds the solids-flux limit; between 1.2× and 1.5× the design SLR the supernatant is still clear and only the underflow gets thinner.

Filter-press chamber utilisation uses the cake volume at normal capture, even when overloaded (a small simplification).

## Mass balance
A connected sludge stream is a normal pipe. Only disposal points (and unconnected sludge ports) take mass out of the system, so the system balance is: in = effluent + disposal + unconnected sludge + gas/consumed − produced.

## Liquid scheduled-waste haulage (added 2026-11-22)
A sludge-disposal point can be placed in **liquid mode** ("Liquid Waste Haulage", tag LH-xx). It stands for a licensed scheduled-waste contractor tankering liquid off site, and is meant for **small volumes of concentrated liquor**. Typical case: a vacuum evaporator on a segregated nickel drag-out stream, with the Ni concentrate hauled away.

- **Inlets:** accepts process, concentrate, brine or sludge lines (a normal sludge disposal point still accepts only sludge).
- **Cost:** per m³ hauled (GAME MODEL, `verify:` current Malaysian scheduled-waste tanker rates).
  - Metal-bearing liquor, total heavy metals > 5 mg/L: RM 900/m³.
  - General liquid scheduled waste: RM 350/m³.
- **Mass balance:** the stream leaves the system boundary as hauled waste. It is **not a discharge**, so it is not tested against the effluent standard and does not break zero liquid discharge. Cost goes to the sludge/disposal OPEX.
- **Volume check:** above one tanker load per day (10 m³/d) the design warns that haulage is uneconomic and the stream should be concentrated first.
