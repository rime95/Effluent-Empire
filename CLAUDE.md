# EFFLUENT EMPIRE — Core Engineering Rules

An industrial wastewater treatment consultancy tycoon game with a real engineering simulation underneath.
Stack: TypeScript + React 18 + Vite, Zustand, @xyflow/react, Vitest.

## Visual rule
All visuals are **2D for now** (SVG, CSS, HTML canvas). Do not add 3D libraries (three.js etc.). The future company "world" view is a 2D site map.
Theme: deep navy chrome, light-grey CAD canvas, cyan flow, blue clean water, brown sludge, green biological, orange chemical, red alarms. Restrained motion.

## Commands
- `npm run dev` — dev server (port 5173)
- `npm test` — all simulation/game tests (must pass before any change is considered done)
- `npm run build` — type-check + production build

## Folder map
- `knowledge/` — engineering knowledge base. **Read the matching doc before editing a simulation module**, and update the doc when a model changes.
- `src/simulation/` — pure TS engine, no React. `core/` (units, stream, mass balance), `chemistry/`, `physical/`, `biological/`, `treatment/` (catalogue, process graph, compliance), `regulations/standards.json`.
- `src/game/` — company state, customer generator, laboratory, project loop, save.
- `src/ui/` — React screens; `studio/` is the PFD Engineering Studio.
- `tests/` — Vitest suites. Reference values cite the `knowledge/` doc they come from.
- `.claude/agents/` — specialist reviewers (process engineer, industrial chemist, biological engineer, QA).

## 1. Engineering accuracy
All treatment calculations must follow established chemical, biological, physical and environmental engineering principles.
Never invent chemical reactions, treatment efficiencies, design equations or engineering assumptions.
When implementing a model: identify governing equations, define variables and units, state assumptions and validity limits, implement unit consistency, add validation tests.

## 2. No arbitrary treatment efficiencies
Fixed removal percentages must never be the sole basis of a calculation. Performance depends on wastewater characteristics, operating conditions, technology and process limitations.
Simplified game models are allowed; their assumptions must be documented in `knowledge/` and marked `GAME MODEL` in code comments.

## 3. Chemistry engine
Accounts for acid-base equilibria (charge balance, carbonate system, alkalinity), stoichiometry, solubility products, hydroxide precipitation and metal speciation, coagulation/flocculation and chemical dosing.

## 4. Biological engine
Accounts for biodegradable substrate, biomass, Monod growth, endogenous decay, oxygen and nutrient requirements, temperature, pH, HRT, SRT and inhibition.

## 5. Mass balance
Every unit returns `{ out, sludge, gas, consumed, produced }`. Mass is never created or destroyed without a documented transformation. `checkMassBalance` must pass for every unit.

## 6. Units
SI internally. Concentration mg/L (= g/m³), flow m³/d, volume m³, mass kg/d, temperature °C, pressure kPa. Molar quantities in mol/L only inside chemistry solvers. All conversions go through `src/simulation/core/units.ts`.

## 7. Regulatory compliance
Each regulated parameter is evaluated independently. Limits live only in `src/simulation/regulations/standards.json` (versioned). Never hardcode limits elsewhere.

## 8. Validation
A model is not complete until equations are reviewed, unit conversions tested, mass balance checked, edge cases tested and results compared with reference calculations in `knowledge/`.
Constants marked `verify:` in `knowledge/` still need human confirmation against primary sources.

## 9. Game design
Accuracy coexists with fun. Simplified models are fine if transparent and physically plausible. Keep simulation components modular and independently testable. The game should explain *why* a design passes or fails (`compliance.ts` explanation trace).

## Review workflow
Implement → relevant specialist agent reviews against `knowledge/` → `qa-engineer` reviews units/mass balance/tests → fix → record notable decisions in the knowledge doc.
