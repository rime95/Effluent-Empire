# 3D site view (Engineering Studio, "3D" sheet)

Modules: `src/ui/plant3d/` — `dims.ts`, `siteLayout.ts`, `models.tsx`, `Site3D.tsx`. Added 2026-11-28 after the user lifted the 2D-only rule.

## What it is
The same `ProcessGraph` as the PFD, drawn on a site plan in 3D: an orthographic camera at the true isometric angle (elevation 35.26°, azimuth in 90° steps), plus a top view.
- **No new simulation:** moving a unit on the site changes only `node.site`, which `processKey` ignores, so the design is not re-simulated.
- **Shared editing rules:** the PFD and the site use the same rules from `src/ui/studio/editing.ts`. A parity test checks `canConnect` against the old PFD rule for every combination.
- **Separate chunk:** three.js, react-three-fiber and drei load only when the 3D tab is opened (about 240 KB gzipped).

## Unit sizes (GAME MODEL, `dims.ts`)
The parameter the engineer sized is kept exactly; only the shape is assumed. Tested in `tests/ui/plant3d.test.ts`.

| Unit | Kept | Assumed |
|---|---|---|
| Clarifier, thickener | surface area (⌀ = √(4A/π)) | depth from the `depth` parameter (clarifier), 3.5 m thickener |
| EQ | volume | 4 m side water depth, L:W = 2 |
| Activated sludge | volume | 4.5 m SWD, L:W = 2.5 |
| MBR | volume | 4 m SWD |
| Oil separator, DAF | area | L:W = 3 |
| Sand filter | area | L:W = 1.5 |
| Stirred reactors (pH, precipitation, Cr reduction, sulfide, Fenton) | volume | H = D, min D 1.2 m |
| Coagulation | Q × floc time | 3 m deep, + 15 % for the flash-mix chamber |
| UASB | volume | H = 6 m |
| Activated carbon | Q × EBCT, two vessels | 2.5 m bed |
| Ion exchange | resin volume per column | 1.5 m bed |
| Electrowinning | cell length 2 + A/12 m from cathode area | |
| UF, RO, evaporator, dryer, filter press | standard skid sizes | filter press length grows with chamber volume |

## Water colour
Each tank shows the water it lets out, scored by `waterQualityIndex` (the SCADA live-view index: 0 meets the standard, 1 is 30× over the worst limit) and coloured by `waterColor`.
- Process pipes use the same colour.
- Sludge and RAS (return activated sludge) lines are brown; reject lines (brine, concentrate, eluate) are amber; pipes with no flow are grey.

## Default site plan (`siteLayout.ts`)
Units the player has not placed keep the PFD's rows and order.
- **Spacing:** the real footprints plus a 3 m access gap.
- **Lanes:** a row folds back and forth in lanes of about 45 m, and units on a returning lane are turned 180° so they still face the flow.
- **No overlaps:** footprints never overlap, which is tested on the megaproject reference design.
- **Placed units:** a unit placed in 3D (`node.site`) keeps its position and rotation.

## Pipes
Right-angle routes: out of the nozzle by 1.2 m, down to a run at 0.55 m (sludge at 0.25 m, with small lane offsets), across along x then z, and up into the target inlet. Lines are drawn in screen-space width.
