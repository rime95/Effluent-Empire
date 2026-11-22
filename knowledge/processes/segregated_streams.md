# Segregated raw-wastewater streams (added 2026-11-22)

Many factories drain more than one raw stream: a dilute main rinse plus a small, difficult stream. Usual practice is to treat each stream on its own at its small flow and high concentration, then combine the pretreated streams into the main train.

**User decision:** blending raw streams is allowed and never penalised ("this is creativity"). No contract rule exists. The existing chemistry decides whether a design passes.

## Model
- **Container.** `Stream.side?: SideStream[]` (`{ id, label, stream }`) on the plant influent only. It is a container for plant inlets, not chemistry:
  - `cloneStream` deep-copies it;
  - `blend` drops it;
  - units never see it.
- **Helpers:** `mainInlet`, `allInlets`, `totalInfluent`, `totalQ`, `mapInlets` (in `core/stream.ts`).
- **Process graph (`treatment/graph.ts`):**
  - **Inlet nodes.** An influent node with `params.source = id` is that side stream's inlet. Missing = main inlet.
  - **Validation.** Exactly one main inlet and one inlet per source. `simulate` also checks that every side stream has its inlet (`graph.sideMissing`) and that no inlet names a stream the plant doesn't have (`graph.sideUnknown`). An unpiped inlet gives "has nowhere to go".
  - **Solver.** Each inlet gets its own stream. The plant mass balance input is the sum of all inlets. `influentQ` (reuse / ZLD fractions) is the total. The CAPEX sizing proxy uses the blended total.
- **SCADA dynamics (`plantDynamics.ts`).** Every inlet follows its own diurnal pattern. Slugs and surges act on the main stream.
- **Commissioning and O&M.** Day-to-day variability (`commissioningInfluent`) and the production growth factor are applied to every inlet. Single-stream plants are unchanged: the main inlet draws first. O&M staffing and fees use `totalQ`.
- **Laboratory.** Each side stream has its own declared datasheet (`Enquiry.declaredSide`, own RNG stream `seed·7727 + i`). The project keeps `sideDatasheets` / `sideTestsDone`; lab-queue items carry `source`. Tests are run and paid per sample point. The Studio design basis (`projectDesignBasis`) is the main basis with each side basis attached.

## Clients (`src/game/variants.ts`)
All ranges are GAME MODEL, `verify:` against plant data.

| Variant | Needs | Side stream | Reference design (treat, then combine) |
|---|---|---|---|
| `chromeSegregated` | none, reputation ≥ 10 | chrome rinse, 5–15 % of the flow; Cr(VI) 20–80 mg/L, Cr(III) 1–5, pH 3–3.8. The main rinse has no Cr(VI). | Cr(VI) reduction at the side flow → main EQ → metal train. Standard B (the base metal train misses A on O&G for some feeds: held fix B1). |
| `enSegregated` | sulfide | electroless-nickel line, 3–8 % of the flow; Ni 50–300 mg/L (90 % complexed by citrate/lactate), 150–400 mg/L biodegradable COD (organic acids), pH 4.5–5.5 | pH 9 → NaHS at 1.3× stoichiometric on the total Ni → joins the main train at coagulation (colloidal NiS caught with the hydroxide floc) |
| `dragOut` | electrowinning | static drag-out, 1–3 m³/d; Ni 2–8 g/L, Cu 0.3–2 g/L, sulfate 60 mM, pH 2–3 | electrowinning (cathode ≈ 2 m² per kg/d of metal, 200 A/m², metal credit) → spent liquor to main EQ |
| `foodHighStrength` | uasb | syrup / reject product / first CIP rinse, 5–10 % of the flow; COD 15–40 g/L (88.5 % readily biodegradable, 10 % slowly, 1.5 % inert), NH₄-N 1 % of COD, 35 °C, pH 4.5–5.5 | neutralise to pH 7 → UASB at 8 kg COD/m³·d → main EQ → food train (aeration +20 %, alkalinity held at pH 7) |

- **Base seed.** Side streams are created by the variant overlay on the variant's own RNG stream, so the base enquiry for a seed is unchanged.
- **Flow split.** Where the side stream is a share of the factory's flow, the main flow is reduced by the same amount (same total water use). The drag-out is additional.

## Decisions
- **Inert share of the high-strength food stream: 1.5 %.** It was first set at 5 %, which put up to 200 mg/L of non-biodegradable COD into the blended main train. That is unrealistic for syrup/CIP waste and made the reference fail.
- **No free-ligand model.** Raw EN blended into the rinse keeps its complexed Ni at the blended concentration. Complexing of the rinse's own Ni/Cu by excess ligand is not modelled; it would be a penalty the user did not want.
