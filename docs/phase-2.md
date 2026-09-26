# Phase 2 — Trips, season map, checklists, readiness, share links

Built on branch `dev` (this worktree), against `2dddc6d` (descendant of the Phase 0/1 foundation
commit `a5da625`). Owns `src/features/trips/**`, `src/model/trips.ts` (unchanged — the
coordinator's contract shape already matched what this phase needed), `api/src/functions/share.ts`,
`api/src/lib/store.ts`, `api/src/lib/sqlStore.ts` (extended, no new migration needed), and
`api/src/lib/shareService.ts`.

## What's built

- **`/trips`** — a MapLibre season map (home base pin from Settings + numbered pins for any trip
  with a location) and a list of all five trips sorted by date/level, each showing status, dates
  (or target window) and live readiness %. "+ New trip" creates a blank trip and opens it.
- **`/trips/:id`** — the trip page: name, level, status, target window, start/end dates (nights
  derived), kind chips, towing toggle, campground picker (from any `campground` records), location
  (tap the map or type lat/lng + a label — coordinates are never invented, they start `null`),
  boat launch (same pattern), peak sun hours override, notes. One "Save" button per the app's
  existing draft-then-save convention (see `Settings.tsx`).
  - **Gear to bring** — every `gear` record with a checkbox; "Use suggested" sets it to gear whose
    `packFor` includes `'all'` or one of the trip's kinds (`defaultGearIds` in `utils.ts`).
  - **Checklist** — grouped, big tap-to-check rows (`min-h-12`), a progress bar, an "Add" box for
    custom items, and "Refresh" (adds anything newly missing; never touches checked or custom
    items — see below).
  - **Readiness** — an overall % plus every part's own score and a one-line reason.
  - **Share** — create/copy/revoke a read-only link. Creating calls `POST /api/share`; the token is
    kept locally in a `share_link` record so both phones see the active link and can revoke it.
  - Then, in order, the other phases' slots: `TripReservationSection`, `TripWeatherSection`,
    `TripTrailsSection`, `TripDebriefSection`.
- **`/s/:token`** (`SharePage`, public, no sign-in) — fetches `GET /api/share/:token` and renders
  name, dates, campground, site #, a map + label, and any routes/pins. Never shows a confirmation
  number or cost (the server redacts those before they leave the database). A revoked or unknown
  token, or a network failure, shows a plain-language message and writes nothing locally.
- **`TripsDashboardCard`** — the next trip (by date, else level) that isn't done/cancelled, a days
  countdown (once dates are set), readiness %, and checklist progress.
- Every map (season map, trip map, share page map) calls `attachTrailLayers(map, {tripId})` after
  `load` and cleans it up on unmount (`src/features/trips/TripMap.tsx`), and turns a tile/offline
  failure into an inline message instead of crashing — verified in a real browser (see Testing).

### Seeds (`src/features/trips/seed.ts`)

The five-trip progression from the brief (`trip:1-shakedown` … `trip:5-offgrid`), status `idea`,
dates/location/campground `null`, `gearIds: []`, and the brief's description copied into `notes`.
Kinds/towing match the brief exactly (trips 1–4 tow the boat, trip 5 — off-grid finale — does not).

## Checklist rules (`checklist.ts`)

`generateChecklist(tripId, trip, templates, gear, pastDebriefs)`:

1. **Templates** whose kind is `'all'`, `'departure'`, or one of the trip's own kinds — each
   template's items, in the template's own item order, grouped under the template's name.
2. **Trip gear** (`trip.gearIds`, in that order) — one line per item, grouped "Gear".
3. **Forgot last time** — every `forgot` entry from the debriefs passed in as `pastDebriefs`,
   grouped "Forgot last time". A separate helper, `pastDebriefsFor(trip, allTrips, allDebriefs)`,
   picks which debriefs count as "past": a trip with an earlier `startDate`, or — when neither trip
   has a date — a lower `level`. The trip page calls this before calling `generateChecklist`.

All lines are deduped by normalized text (trimmed, lower-cased, collapsed whitespace); the first
source to add a line wins, and order is stable (same inputs always produce the same list — this is
covered by `checklist.test.ts`).

**Refresh** (`missingChecklistItems(existing, generated)`) never edits or removes anything already
on the trip — checked state and hand-typed custom items are untouched — it only returns the newly
generated lines whose normalized text isn't already present, so the trip page can add just those as
new `trip_checklist_item` records, continuing the existing `order` sequence.

## Readiness formula (`readiness.ts`)

Seven parts, each scored 0–100 with a plain-language reason, combined as a weighted average
(weights sum to 100 — checked by a test):

| Part | Weight | Scoring |
|---|---|---|
| Checklist | 25 | % of checklist items checked (0 if there's no checklist yet) |
| Reservation | 15 | 100 if the campground's `bookingSystem` is `first-come`/`dispersed` (no reservation needed); 100 if booked; 50 if waitlisted; else 0 |
| Dates | 10 | 100 if both `startDate`/`endDate` are set, else 0 |
| Location | 10 | 100 if `trip.location` is set, else 0 |
| Gear | 20 | % of the trip's gear that's `own`/`ordered` rather than `wishlist` (0 if no gear assigned) |
| Load & tow | 10 | Runs `computeLoad` (Phase 1) with the trip's gear, vehicle, trailer and the shared `load_profile`: over → 40, near → 80, ok/unknown → 100 |
| Power | 10 | Runs `computePower` with the shared `power_profile` and the trip's `peakSunHours` override: flat before the trip ends → 40, ends under 20% → 80, else 100 |

Load and power score 100 ("not applicable") when Phase 1 hasn't created a `load_profile` /
`power_profile` record yet, rather than penalizing a trip for a tool that doesn't exist yet.
Change `READINESS_WEIGHTS` in `readiness.ts` if the weighting should shift; a test asserts the
weights still sum to 100.

## Server: share links

`api/src/functions/share.ts` (SWA already routes `/api/share/*` as anonymous, so every write
authorizes itself in code, same pattern as `sync.ts`):

- `POST /api/share { tripId }` — family only (`authorize()`); 400 on a malformed/missing `tripId`,
  404 if the trip doesn't exist; otherwise a random 32-byte base64url token (`generateShareToken`
  in `shareService.ts`) is stored via `Store.createShareLink` and returned as `{ token }`.
- `DELETE /api/share/:token` — family only; revokes (idempotent — revoking twice, or a token that's
  already revoked, still returns 200); 404 for a token unknown to this household.
- `GET /api/share/:token` — public; 404 for an unknown or revoked token or a missing trip; otherwise
  `{ trip, campground, reservation, routes, pins }`, where `reservation` is redacted by
  `redactReservation()` to `{ status, arrivalDate, nights, site }` — no confirmation number, no
  cost, ever (verified in `shareService.test.ts` and `share.test.ts` by asserting the raw
  confirmation string never appears in the JSON).

`Store` (and both `MemoryStore` and `SqlStore`) gained: `getRecord(householdId, type, id)`,
`getRecordsByTripId(householdId, type, tripId)` (used for `reservation`/`route`/`pin`, matching on
`JSON_VALUE(data,'$.tripId')` in SQL), `createShareLink`, `getShareLink`, `revokeShareLink`. No
migration was needed — the `dbo.share_links` table already existed from the Phase 0 migration in
anticipation of this phase.

## Testing

- **Pure logic** (`src/features/trips/*.test.ts`, `api/src/lib/*.test.ts`,
  `api/src/functions/share.test.ts`): checklist generation/dedupe/ordering, "past trip" selection,
  refresh diffing, the full readiness formula (including the N/A/first-come/dispersed/over-limit
  cases), share token generation, reservation redaction, and the share HTTP handlers end to end
  against `MemoryStore` (401/403/400/404 paths, the redacted payload, revoke-then-404).
- **SQL integration** (`api/src/lib/sqlStore.test.ts`): ran against a real SQL Server 2022 container
  as instructed — migrations, the existing sync test, and the new `getRecord` /
  `getRecordsByTripId` / share-link lifecycle, all passing. Container removed afterward.
- **Real browser run** (Vite dev server + a headless Chromium driver script, since this repo has no
  jsdom/testing-library setup — `vitest`'s `environment` is `node`): loaded `/trips` and a trip
  detail page, confirmed the season map, trip list, readiness numbers (a fresh trip reads 20%,
  matching the formula by hand), toggled a checklist item, added and checked a custom item, edited
  and saved a trip (draft/dirty/"Saved" states worked), and exercised both share-flow failure paths
  (share creation and the public share page) with no `/api` backend running — every case degraded
  to a plain-language message with **zero console or page errors**, including the "map tiles
  unavailable" path (this sandbox has no route to the tile host, which conveniently exercised that
  exact code path for real).
- `npx tsc -b`, `npm test` (41 passed), `npm run build` all pass at the repo root; `cd api && npm
  run build && npm test` passes (20 passed, including the live-SQL test).

## Requests for coordinator

- None blocking. `src/model/trips.ts` as scaffolded already matched everything this phase needed —
  no changes were made to it.
- Noted but not needed yet: `checklist_template`, `gear`, `load_profile`, `power_profile`,
  `campground`, `reservation`, `route`, `pin`, `debrief` records are all currently empty (Phases 1,
  3, 4, 5 not built yet in this tree), so the trip page correctly shows "no gear yet" / "no
  checklist yet" / readiness N/A for load & power. Nothing to do — this is exactly the fallback
  behavior it's designed to have once those phases land.
- The production JS bundle is ~1.5 MB (mostly `maplibre-gl`) — Vite warns about the chunk size.
  Not a regression I introduced beyond adding the map usage the contract asked for, and no new
  dependency was added, but a future pass could code-split the map behind a dynamic `import()` if
  bundle size becomes a concern on cell connections.

## Risks / open items

- Share links have no expiry — only explicit revoke. Fine for a family link shared over text/email;
  flagging in case the owner wants an expiry later.
- `POST /api/share` always mints a new token rather than reusing an existing active one; the trip
  page's UI only offers "Create" when there's no active link, so in normal use this doesn't create
  duplicates, but calling the API directly could.
