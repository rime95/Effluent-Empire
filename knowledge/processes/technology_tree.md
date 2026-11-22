# Technology Tree (added 2026-11-22)

Module: `src/game/tech.ts`, screen `src/ui/screens/TechTree.tsx`. Player decisions (2026-11-22):
- every unit that existed before the tree is **basic and available from the start**;
- the tree holds only **advanced** technologies;
- research costs **cash only** and is instant;
- each technology opens **tougher clients** that need it.

## Rules
- **Reputation by tier:** T1 10, T2 25, T3 40, T4 60. Prerequisites are listed per technology.
- **Cost** is booked as a `research` ledger line. The cash + RM 250k credit line must cover it.
- **Availability:** a technology is "in development" (not researchable) until its engineering model, knowledge doc and tests are in the game (`available: true`).
- **Studio locks:** locked units appear in the palette with a padlock and cannot be added, pasted or dropped.

| Tier | Technology | Needs | Cost (RM, GAME MODEL, verify) | Opens |
|---|---|---|---|---|
| 1 | DAF | – | 120k | emulsified-oil food / edible-oil refineries |
| 1 | Sludge dryer | – | 150k | sludge-heavy metal finishers with a disposal-cost cap |
| 2 | Ultrafiltration | – | 160k | RO/MBR pretreatment |
| 2 | Sulfide precipitation | – | 140k | Standard A high-nickel platers |
| 2 | Ion exchange | – | 180k | semiconductor Standard A copper polishing |
| 2 | Anaerobic UASB + biogas | – | 300k | palm oil mills (POME) |
| 3 | Reverse osmosis | UF | 350k | high-TDS clients |
| 3 | Water reclaim | RO | 200k | reuse-target clients |
| 3 | Electrowinning | Ion exchange | 250k | concentrated drag-out streams |
| 3 | Advanced oxidation | – | 220k | textile dyeing |
| 3 | MBR | UF | 280k | high-strength food, Standard A, small site |
| 4 | Vacuum evaporator | RO | 500k | zero-liquid-discharge clients |

## Tough clients (`src/game/variants.ts`)
- **Chance:** once a technology is researched, each new enquiry for a matching industry has a 40 % chance of being one of its variants.
- **Independent randomness:** a variant draws from its **own RNG stream** (`seed·7919 + 17`). The base enquiry for a seed (wastewater, standard, price draws) is identical with or without the variant system, so existing tests and saves keep their values.
- **Overlay:** the variant reshapes the true wastewater within documented ranges.
- **Pricing:** the job is priced from a reference design that uses the technology, × 1.15 tough-job premium (GAME MODEL).
- **Availability:** variants are registered with each technology's model; none exist before then.

## Customer names (`src/game/clientNames.ts`)
- **Generic names:** about 40 fictional names per industry (common Malaysian company-name parts).
- **No repeats in play:** a name already used by an open enquiry, a live project or an operated plant is skipped. The next unused name in the list is taken with no extra RNG draw, so only the name changes. If every name is in play, "(second site)" is appended.
