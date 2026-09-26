# Parallel build: ownership & contracts

Phases 1–5 are built in parallel by separate agents on separate branches, then merged by the coordinator. To keep merges clean, **each phase owns a folder and a few files, and only edits those.** Shared files are pre-wired with slots.

## Ownership

| Phase | Owns (may create/edit) | Must not edit |
|---|---|---|
| 1 Gear, calculators, checklists | `src/features/gear/**`, `src/model/gear.ts`, `src/calc/**` | everything else |
| 2 Trips & map | `src/features/trips/**`, `src/model/trips.ts`, `api/src/functions/share.ts`, `api/src/lib/store.ts`, `api/src/lib/sqlStore.ts`, `api/src/lib/migrations.ts` (add only), `api/src/lib/share*.ts` | everything else |
| 3 Reservations | `src/features/reservations/**`, `src/model/reservations.ts`, `api/src/functions/ridb.ts`, `api/src/lib/ridb*.ts` | everything else |
| 4 Trails & offline | `src/features/trails/**`, `src/model/trails.ts`, the `workbox` section of `vite.config.ts` | everything else |
| 5 Weather, journal, photos | `src/features/journal/**`, `src/model/journal.ts`, `api/src/functions/files.ts`, `api/src/lib/files*.ts` | everything else |
| Coordinator | `src/model/core.ts`, `src/model/schemas.ts`, `src/App.tsx`, `src/components/**`, `src/pages/**`, `src/db/**`, `src/sync/**`, `package.json`, `api/package.json`, `public/staticwebapp.config.json`, `README.md`, `docs/PROGRESS.md`, `.github/**` | — |

Rules for every phase:
- **No new npm dependencies.** Already installed: `maplibre-gl`, `@tmcw/togeojson`, `zod`, `dexie`, `dexie-react-hooks`, `react-router-dom`; API: `@azure/functions`, `mssql`, `@azure/storage-blob`. If you truly need another, stop and report it.
- Need a change in a file you don't own (a shared UI component, a new route in the SWA config, an env var)? Don't edit it. Build a local version in your folder, and list the request in your phase notes (`docs/phase-N.md`).
- Your schema file may be **extended** (new optional fields, new record types). Don't rename or remove fields in `core.ts` or in another phase's file. New record types must also be added to `src/model/schemas.ts`. That file is the coordinator's, but list the addition in your notes and the coordinator merges it.
- Use `useRecord`, `useRecords`, `saveRecord`, `deleteRecord`, `newId` from `src/db/records.ts`, and UI primitives from `src/components/ui.tsx` (read-only).
- Seeds: export yours from `src/features/<you>/seed.ts` (fixed ids, via `seed()` from `src/seed/types.ts`). They're written with timestamp 0, so real edits win.
- Never invent facility locations, rules, fees or booking windows. Use official sources, or `null` plus a `verify` note. Numbers carry `SpecNumber` status where relevant.
- Mobile-first: tap targets ≥ 44 px (`min-h-11`/`min-h-12`), and both day and night themes via the color tokens (`bg-surface`, `text-ink`, `text-ink-2`, `border-line`, `text-brand`, `bg-warn-bg`, …).
- Tests next to your code (`*.test.ts`) for any logic. Before finishing, run `npx tsc -b`, `npm test` and `npm run build` (and `cd api && npm run build && npm test` if you touched the API).

## Slots (pre-wired by the coordinator)

| Slot | File | Filled by | Used by |
|---|---|---|---|
| Routes `/gear/*`, `/tools/*` | `features/gear/routes.tsx` | 1 | App |
| Routes `/trips/*` | `features/trips/routes.tsx` | 2 | App |
| Routes `/book/*` | `features/reservations/routes.tsx` | 3 | App |
| Routes (optional) | `features/trails/routes.tsx`, `features/journal/routes.tsx` | 4, 5 | App |
| Home cards | `GearDashboardCard`, `TripsDashboardCard`, `BookingDashboardCard` | 1, 2, 3 | Dashboard |
| Public page `/s/:token` | `features/trips/SharePage.tsx` (no sign-in) | 2 | App |
| Trip page section: reservation | `features/reservations/TripReservationSection.tsx` `{tripId}` | 3 | 2's trip page |
| Trip page section: trails | `features/trails/TripTrailsSection.tsx` `{tripId}` | 4 | 2's trip page |
| Trip page sections: weather, debrief | `features/journal/TripWeatherSection.tsx`, `TripDebriefSection.tsx` `{tripId}` | 5 | 2's trip page |
| Map layers | `features/trails/mapLayers.ts` `attachTrailLayers(map, {tripId})` → cleanup | 4 | every map 2 builds |
| Photo picker | `features/journal/PhotoAttach.tsx` `{value, onChange, tripId}` | 5 | 4's pins, 5's debrief |
| Checklist generator | `features/trips/checklist.ts` `generateChecklist(...)` | 2 | 2; reads 5's `debrief.forgot` |
| Base map style | `src/lib/map.ts` `MAP_STYLE_URL` (OpenFreeMap default, env `VITE_MAP_STYLE_URL`) | — | 2, 4 |
| On-phone binary storage | `db.blobs` table (`src/db/local.ts`) | — | 5 (photos), 4 (optional) |

## Cross-phase data dependencies (read-only)

- 2 reads 1's `gear`, `checklist_template`, `load_profile`, `power_profile` and the pure calculators in `src/calc/` for readiness.
- 2 reads 3's `reservation` records (by `tripId`) for readiness and the share page. 3 reads 2's `trip` (dates, `campgroundId`).
- 2 reads 5's `debrief` records for "forgot" items. 5 reads 2's `trip.location` for weather.
- 4 reads 2's `trip` for map context. 2 calls 4's `attachTrailLayers`.
- The share endpoint (2) may include 3's reservation (**without confirmation numbers**) and 4's routes and pins.
- Server: 2 owns store/migration changes. 3's RIDB proxy and 5's file API must not need database changes.

## Owner decisions (apply everywhere)
- No reminders of any kind (no email, .ics or push). Countdowns are shown in the app only.
- iPhone only. The app must work offline once installed to the Home Screen.
- onX Offroad: exchange GPX/KML files only (import and export). No scraping.
- Azure hosting (Static Web Apps Free, Azure SQL free offer, Blob Storage). Flag anything that could cost money.
