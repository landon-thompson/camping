# Phase 1 — Gear, budget, calculators, checklists

Status: **built, awaiting owner review.**

## What's built

**Data** (`src/model/gear.ts`, already wired into `src/model/schemas.ts` by the coordinator): `gear`, `budget_category`, `checklist_template`, `load_profile`, `power_profile`.

**Seeds** (`src/features/gear/seed.ts`):
- All `budget_category:*` and `gear:*` records from the existing `seedData.ts` (unchanged — it already matched the brief).
- Five checklist templates: `checklist_template:boat` (Minnesota AIS law), `no-hookup`, `off-grid`, `toddler`, `departure`, with the exact item text from the brief.
- `load_profile:default` — Adult 1/Adult 2 170 lb, Toddler 30 lb (all `estimate`, "placeholder — enter real weights"), 12 gal water, towing off, wishlist included.
- `power_profile:default` — EcoFlow Delta 3 Plus 1,024 Wh (`verify`), 90% usable (`estimate`), fridge 350 Wh/day, fan/lights/phones 100 Wh/day, small AC 400 W × 4 h (disabled), 200 W solar at 4 h / 72%, no drive charging, 3-day trip.

**Screens** (`src/features/gear/routes.tsx` → `gearRoutes`):
- `/gear` — item list grouped by budget category, with status and location filters. Each row shows status, priority (P1–P5), price (actual, a `$low–high` range, or "no price yet"), location, and a "verify" flag.
- `/gear/new`, `/gear/:id` — full edit form (category, status, priority, quantity, prices, in-budget/optional flags, weight as a `SpecNumber` with confidence, power draw, location, pack-for trip-kind chips, notes, verify note); inline "tap again to delete" (no `window.confirm`); quick "Mark ordered" and "Mark bought" (the latter asks for the price paid via an inline field, not a browser prompt).
- `/gear/budget` — editable season budget, editable per-category budgets, a spent/planned bar per category, unpriced-item counts, a warning when category budgets add up to more than the season budget, and the optional-extras total.
- `/gear/next` — the wishlist in buying order (priority, then price), a running total, and a "Budget runs out here" divider; quick "Mark ordered" per row.
- `/tools` — links to the three tools below.
- `/tools/load` — `computeLoad` over the GX550, the boat trailer, `load_profile:default`, and all owned/ordered gear (plus wishlist when "include wishlist" is on): payload/roof/tow gauges (ok/near/over), tongue-weight range, a weight breakdown, a linked list of gear with no weight entered, and warnings. Person weights, water/fuel/other, towing and include-wishlist all autosave to the profile ~400 ms after you stop typing. Vehicle/trailer limits show their verify status with a link to Settings.
- `/tools/power` — `computePower` over `power_profile:default`: edit the battery, each load (daily Wh or watts × hours), solar, drive charging, start % and trip length; shows consumption, solar generation, net Wh/day, days of autonomy ("Indefinite" when charging keeps up), end-of-trip %, and the day the battery goes flat. Always shows the cargo-outlet note, and warns (louder above 400 W) if drive charging is set above the recommended ~300 W.
- `/tools/checklists`, `/tools/checklists/:id` — list and edit templates: name, description, and items (add, rename, delete, reorder).
- `GearDashboardCard` on the home screen — spent/planned/remaining plus the next 3 buy-next items, linking to `/gear`.

## Usage notes

- All calculators (`src/calc/budget.ts`, `limits.ts`, `load.ts`, `power.ts`) were already built with tests before this phase; the screens are thin UI over them.
- New pure helpers added in `src/features/gear/format.ts` (price/label formatting, the own/ordered/wishlist filter used by the load tool) have their own tests in `format.test.ts`.
- A small `useAutoSaveDraft` hook (`src/features/gear/useAutoSaveDraft.ts`) debounces saves for the two calculator profiles; every other form uses the app's existing explicit-Save pattern (see `Settings.tsx`).

## Verify items (already flagged in the data, listed here for visibility)

- Vehicle payload/roof/tow figures (`vehicle:gx550`) — owner to confirm from the door-jamb sticker and manual (Phase 0 item, shown throughout via `StatusChip`).
- Boat/trailer weight range — replace with a CAT-scale ticket.
- `power_profile:default` battery Wh is `verify`; usable % and per-load Wh figures are `estimate` — adjust after real trips.
- AIS checklist text is sourced generically ("verify current rules with the MN DNR") per the no-invented-rules rule; the owner should check it against the current MN DNR page each season.

## Requests for coordinator

- None outside owned files. No new dependencies were needed.
- `src/features/gear/**` and `src/model/gear.ts` were the only files touched, plus `src/calc/**` was read but not modified (calculators and their tests were already complete).

## Tests

- `npx tsc -b`, `npm test` (26 tests across `calc/calc.test.ts`, `seed/seed.test.ts`, and the new `features/gear/format.test.ts`), and `npm run build` all pass.

## Risks / open questions for the owner

- The load and power tools autosave silently (no "saved" indicator) to keep the debounced-input UX simple; if that's surprising in practice, an inline "saved" cue could be added.
- `/tools/checklists/:id` uses the app's standard explicit Save button (edits to items are local until you tap Save), rather than autosaving — flag if you'd rather it autosave like the calculators.
