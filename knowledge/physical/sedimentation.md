# Sedimentation, Flotation of Oil, and Secondary Clarification

Modules: `src/simulation/physical/settling.ts`, `physical/units.ts` (`clarify`, `separateOil`).

## Ideal settling basin (Hazen / Camp)
A particle with settling velocity v in an ideal rectangular basin is removed with probability min(1, v/SOR).
SOR (surface overflow rate) = Q/A; it is evaluated at **peak** flow (Q × peak factor), because that is when carry-over happens.

Each solids pool has a log-normal velocity distribution, ln v ~ N(μ, σ²), with v₅₀ = e^μ:

    R = 1 − Φ(z₀) + (e^(μ + σ²/2) / SOR) · Φ(z₀ − σ),     z₀ = (ln SOR − μ)/σ

σ = 0.8 (GAME MODEL). Φ is computed with Abramowitz & Stegun 7.1.26 (|ε| < 1.5e-7).

Check (tested): for a narrow distribution, R = v/SOR when SOR > v, and R = 1 when SOR < v.

## Pool settling velocities (v₅₀, m/h) — GAME MODEL defaults
| Pool | v₅₀ | Fines (non-settleable fraction) |
|---|---|---|
| grit | 40 | 0 |
| inert mineral | 2.0 | 1 % |
| colloid | 0.005 (does not settle) | — |
| coagulated floc | 0.3–3.0 (grows with flocculation time) | 1 % |
| particulate organics | 0.8 (3.0 after bioflocculation) | 5 % |
| metal hydroxide pin floc | 0.05–0.6 (time × concentration, see `precipitation.md`); floc / polymer floc after coagulation | 2 % → 0.3 % as v₅₀ rises 0.5 → 2 m/h (same curve as the other pools; process review 2026-11-21) |
| Al(OH)₃ / Fe(OH)₃ floc | floc / 1.15 × floc | 1 % |

**Enmeshment in coagulated floc (2026-11-21, practitioner input).** The fines fractions above apply to poorly flocculated solids. A well-run chemical clarifier gives about 5–20 mg/L effluent TSS: solids enmeshed in well-coagulated floc settle with it. For every pool, including the metal hydroxide (which carries the metals and must not keep more fines than the floc it settles in), the fines fraction falls from the table value to 0.3 % as that pool's v₅₀ rises from 0.5 to 2 m/h (`flocFines`, log-linear). Unflocculated colloids still pass. Their capture depends on the coagulant dose (destabilisation), so an under-dosed train still shows high effluent TSS, and the compliance trace says so.

The curve keys on v₅₀ alone, so any fast-settling solid gets the low floor, including raw mineral solids at v₅₀ 2 m/h. At those velocities the Hazen tail dominates anyway.

**Size versus polymer (Hazen tail, σ = 0.8).** Even with the low fines floor, the distribution's slow tail escapes:

| Floc v₅₀ | Peak SOR 1.5 m/h | Peak SOR 1.0 m/h |
|---|---|---|
| 2.5 m/h (no polymer) | ≈ 9 % escapes | ≈ 4 % |
| 4.2 m/h (polymer) | ≈ 2.8 % | ≈ 0.9 % |

So "no sludge in the overflow" needs polymer and a peak SOR of about 1 m/h or less. That matches practice: chemical clarifiers without polymer typically give 20–50 mg/L.

Reference check (tests): the plating train with ferric + polymer leaves < 15 mg/L. The food train goes from 103 mg/L at 75 mg/L ferric (under-dosed) to 14 mg/L near the optimum dose.

## Desludge pump (primary / chemical clarifier)
Parameter `desludge` (m³/d; 0 = auto):
- **Auto:** the underflow is drawn at the sludge make-up concentration (see `sludge_thickening_dewatering.md`).
- **Set flow Q_p:** underflow solids w = M_DS / (Q_p·ρ). More pumping gives thinner sludge, and an info note is shown when w < ⅓ of the typical underflow.
- **Pump too small:** the blanket can compact to at most min(1.5 × the typical underflow, 10 %), the upper limit being what desludge pumps move (GAME MODEL, 🟡 verify). If the pump cannot carry M_DS at that concentration, the blanket rises and the excess leaves over the weir in steady state, lightest solids first: colloids, biomass, Al/Fe floc, floc, hydroxide, organics, then mineral solids and grit. This is flagged as an error.
- **Pump larger than the inflow:** limited to 0.95·Q and flagged as an error, since it would drain the tank.
- **Skimmed oil** is pumped with the sludge and counts in M_DS.
- **After activated sludge:** not used; an info note says the setting is ignored. WAS is set by the RAS/WAS balance (`activated_sludge.md`).

## Lamella (inclined-plate) clarifier
The effective settling area is A_eff = max(A_plan, η·A_plates·cos θ), with θ = 55° and η = 0.8. The plates fill the settling zone, so the plan area is not added on top; the first draft double-counted it until chemistry review.
- 🟡 verify: η 0.7–0.9 is typical.
- SOR is evaluated on A_eff for discrete or flocculent settling.
- Plates are ignored, with a warning, for mixed liquor, which settles as a zone and fouls the plates.
- CAPEX is RM 450 per m² of projected plate 🟡.

The clarifier reports a per-pool removal breakdown and the particulate metal carried over. It also flags pin floc when less than 80 % of the precipitate is captured.

## Secondary clarifier after activated sludge
Discrete-particle theory does not describe mixed liquor at 2–5 g/L, which settles as a zone (hindered settling). The Vesilind relation gives:

    v_s = v₀·exp(−k·X),   v₀ = 6.5 m/h, k = 0.34 L/g

These follow Daigger & Roper (1985), ln v = 1.871 − (0.1646 + 0.001586·SVI)·X, at SVI ≈ 110 mL/g. The first draft's k = 0.45 corresponds to a bulking sludge (SVI ≈ 180).

Effluent carry-over (GAME MODEL). Zone settling moves the whole floc together, so the same fraction applies to every solids pool of the mixed liquor:

    TSS_eff = MLSS · (f_fines + 0.2·max(0, SOR_peak/v_s − 0.7)²)
    f_fines = 0.004 · (1 + 2·max(0, (4 − SRT)/4))     (dispersed growth at short SRT)

At MLSS 3 000 mg/L and a healthy SOR this gives about 12 mg/L TSS, which is typical of well-run plants. As SOR approaches v_s the blanket rises and carry-over grows quickly. Solids loading rate (Q_peak + R·Q_avg)·X/A is reported, with constant RAS R = 0.75 and a warning above about 9 kg/m²·h at peak (about 6 at average flow).

Below the critical SOR/v_s, effluent TSS is fines-limited and independent of SOR. This is real secondary-clarifier behaviour and is tested.

## Oil flotation (Stokes' law)
v = g(ρ_w − ρ_o)d² / (18μ). For a 100 µm droplet with ρ_o = 900 kg/m³ at 25 °C, v ≈ 2.2 m/h (tested). API separators are classically designed for 150 µm droplets.
- Free-oil removal uses the Hazen expression with rise velocity (σ = 1.0).
- Emulsified oil (droplets below about 20 µm) is not separable by gravity.
- Clarifiers include a scum skimmer and remove free oil the same way.

Viscosity uses the Vogel equation μ = 2.414e-5 · 10^(247.8/(T − 140)) Pa·s, giving 0.89 mPa·s at 25 °C (tested).
