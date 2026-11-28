# Game art

**Style C1, "technical colour"** (chosen 2026-11-28 from six style boards). Isometric 2D technical illustration in full natural colour: thin dark ink outlines, soft daylight shading, concrete grey, yellow handrails, cut-away tanks where useful. Cyan is used sparingly, for flow arrows and water. All 2D, per CLAUDE.md.

## Generation
- **Model:** GPT Image 2.6 on Higgsfield, medium quality.
  - 1k resolution for sprites, portraits and headers; 2k for the menu and the map.
  - About 1 credit per image (1.75 at 2k).
- **Style reference:** the C1 style board (Higgsfield job `f95e9973-9d91-4e4a-8618-985ba0502ba6`) is passed as an image reference on every image, so new images match.
- **Prompt template for sprites:** "Single isometric game sprite in exactly the art style of the reference (technical colour illustration, thin dark ink outlines, soft daylight shading, …). Subject: … Isolated on a transparent background, centered, 30-degree isometric view. No text, no logos."
- **Accuracy notes for prompts:**
  - Aeration is a rolling surface from fine-bubble diffusers, not fountains.
  - Clarifiers have a conical hopper and a sludge draw-off.
  - No real landmarks, brands or real people: portraits are fictional.

## Files
- **`art/source/<group>/`**: full-size originals, about 1–2 MB each. They are **not committed** (git-ignored) and stay re-downloadable from the Higgsfield account.
- **`public/art/<group>/`**: game-sized WebP files, which is what the game loads (about 3.5 MB in total).

  | Group | Size | Content |
  |---|---|---|
  | `units` | 320 px, transparent | 23 process units, named by `UnitType` |
  | `portraits` | 256 px | 12 fictional staff: 4 engineers, 2 lab, 3 operators, 3 sales |
  | `industry` | 800 px | plating, food and semiconductor card headers |
  | `offices` | 360 px, transparent | 5 office stages (HQ screen) |
  | `scenes` | 1600 px | `menu.webp` (main menu); `map.webp` (the industrial-corridor base for the Company Map, not used yet) |

## Converting a new image
The browser does the resize and WebP encoding (no image library is installed):
1. Put the original in `art/source/<group>/`.
2. Run `node scripts/art-sink.mjs`, a local helper on 127.0.0.1:5174 that only writes `.webp` files under `public/art`.
3. With the dev server open, in the page console:
   - draw `/art/source/<group>/<file>` onto an OffscreenCanvas at the target width;
   - call `convertToBlob({ type: 'image/webp', quality: 0.86 })`;
   - `PUT` the result to `http://127.0.0.1:5174/<group>/<name>.webp`.

## Where it is used (`src/ui/art.ts`)
Every use falls back to the previous look if a file is missing.
- **Main menu:** key art behind a dark gradient.
- **Enquiry cards:** industry header, plus a CSS tier frame.
- **Employees:** portraits, matched to the first name's community and gender and preferring the employee's role. The founder shows the company badge.
- **HQ:** an office building that grows with reputation and the plants you run.
- **Encyclopedia:** a unit sprite per technology.
