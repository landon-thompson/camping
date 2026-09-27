# Progress & decisions

This file is the hand-off note between work sessions. Update it at the end of every phase.

## Status

**All five phases are built and merged on `dev`** (2026-09-26). The owner asked for the remaining phases in parallel: the coordinator defined shared contracts (`docs/CONTRACTS.md`), five Sonnet agents built one phase each in separate worktrees, and the coordinator merged, integrated and tested the result.

| Phase | Scope | Status | Details |
|---|---|---|---|
| 0 – Foundation | Scaffold, auth, DB + migrations, PWA shell, deploy pipeline | Done | this file, README |
| 1 – Gear, checklists, calculators | Gear CRUD, category budgets, buy-next, load/tow + power calculators, checklist templates | Done | `docs/phase-1.md` |
| 2 – Trips & map | Season map, trip pages, per-trip checklists, readiness, read-only share links | Done | `docs/phase-2.md` |
| 3 – Reservations | Campground directory, booking rules, booking-window countdowns, deep links, reservation tracking, RIDB search | Done | `docs/phase-3.md` |
| 4 – Trails & offline | GPX/KML import + export (onX), route flags, pins, MVUM layer, offline tiles | Done | `docs/phase-4.md` |
| 5 – Weather, journal, polish | NWS forecast, debriefs feeding next checklist, photos (phone + Blob Storage), accessibility review | Done | `docs/phase-5.md` |

Integration pass (coordinator): trip page saves only changed fields (fixed a bug where saving trip details could undo a campground chosen in the reservation section or an edit synced from the other phone); trip page section jump bar, sticky save bar, compact gear list; routes & pins linked from Tools and each trip; accessibility fixes (announced save status, reduced-motion, labelled links, theme toggle buttons); README setup steps for photos and RIDB.

Tests: 190 app + 53 API (plus the SQL Server integration tests, run in CI). Browser smoke test of every screen: no errors.

**Not testable from the build sandbox (network blocked): verify on first real deploy**
- National Weather Service API (api.weather.gov): response parsing and browser CORS. Weather is built from the documented format.
- USFS MVUM map service (`apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer`): reachability/CORS.
- OpenFreeMap tiles and terms: the app caches tiles you view plus a capped "prepare offline" pass (no bulk downloader). Owner may prefer view-only caching or a provider with explicit offline terms (`VITE_MAP_STYLE_URL`).
- Azure deployment itself (owner's Azure setup, README steps 1–10).

## Owner answers (from kickoff)

- Vehicle: **2026 Lexus GX550 Overtrail**. Tow rating 9,096 lb (dealer material; still marked *verify*). Payload ~1,490 lb (*verify*: owner to read the door-jamb sticker). Roof limit 165 lb (*verify* in manual).
- Boat: Lund 1800 Tyee + Mercury 150. No real weights yet, so 3,000–3,800 lb *estimate* until a scale ticket.
- Hosting: **Azure** (owner's own Microsoft account, currently a free-trial subscription → must upgrade to pay-as-you-go before it ends). Owner wants to be told about any cost.
- **No reminders** (no email/.ics/push). Show countdowns in-app only.
- Wife gets her own login (Microsoft account). **Read-only trip share link: yes.**
- Trail app: **onX Offroad** (trial). onX has no public API, so we exchange GPX/KML files (onX app: GPX only; onX web map: GPX + KML; 3,000 markups / 4 MB per file).
- Budget: season budget, adjustable; seeded at $3,000 (priced wishlist mid-points). Category budgets in Phase 1.
- Phones: **iPhone only**. The app must be added to the Home Screen for durable offline storage; there's an in-app hint.

## Architecture decisions

- **Stack:** Vite + React 19 + TypeScript + Tailwind 4 PWA (vite-plugin-pwa), Dexie/IndexedDB, Azure Static Web Apps (Free) + managed Functions (Node 22), Azure SQL free offer. Next.js was dropped: SWA's Next.js hybrid support is preview-only, and a static SPA is simpler offline.
- **Local-first sync:** every entity is a small JSON record `{id, type, data, updatedAt, deleted}`. Last write wins by client timestamp; ties go to the incoming write (the same rule on client `src/sync/merge.ts` and server `api/src/lib/store.ts`/`sqlStore.ts`). Deletes are tombstones. Pull uses SQL `rowversion` with `MIN_ACTIVE_ROWVERSION()` so no change is skipped.
- **Schemas live in the app** (`src/model/schemas.ts`, zod). The server treats `data` as opaque JSON with size/shape limits. New record types usually need **no DB migration**; add them to `recordSchemas`.
- **Seeds** (`src/seed/seed.ts`) use fixed IDs and `updatedAt: 0`, so both phones seed identical records and any real edit wins.
- **Auth:** SWA built-in Microsoft (Entra ID) login; GitHub login blocked. Invite-only role `family`, enforced in `staticwebapp.config.json` and `api/src/lib/principal.ts`.
- **Free-tier DB auto-pause:** API retries transient errors for ~30 s, then returns 503; the app shows "Waking database…" and retries.
- **Rules as data:** booking windows, limits and weights must stay editable records, and anything unverified carries a `verify`/`estimate` status (`SpecNumber`).

## Verified in Phase 0

- Unit tests: sync merge rules, two-phone end-to-end sync against the real server store logic, API validation/auth.
- API integration test against **real SQL Server 2022** (Docker locally; service container in CI): migrations, member upsert, LWW push, paged pull, tombstones.
- Browser run through the SWA CLI emulator + real function handlers + SQL Server: sign-in gate, dashboard, edit → SQL, second family member sees the change, uninvited user blocked, offline reload from service worker.
- Not verifiable from the dev sandbox: the actual Azure deployment (needs the owner's Azure setup).

## Current deployment choice (2026-09-27)

The Azure SQL free offer wouldn't create on the owner's free-trial subscription (portal showed no "Apply offer"; CLI returned InternalServerError twice). The owner chose **no database for now**: run `scripts/azure-setup.sh … --no-db`. The API returns `503 code:not-configured`, the app switches to "On this phone" mode (no retry loop), share links are hidden, and Settings → Backup/Restore protects data. The empty logical SQL server `camp-planner-sql-*` costs nothing and can stay. Revisit after upgrading to pay-as-you-go (free offer may then be available) or with the Basic tier (~$5/mo) if the owner approves.

## Owner feedback round (2026-09-27)
- Season map was empty: seeded campgrounds have no verified coordinates. Choosing a campground now gives the trip its location; map and weather fall back to the campground's location.
- MVUM toggle looked dead: now shows On/Off and "Zoom in to see MVUM roads" (layer draws from zoom 8). Whether the USFS service loads is still unverified.
- State parks: Book → Campground directory → "Import state parks" pulls official DNR boundary data on the phone (Met Council service, unverified from sandbox) or from a GeoJSON file from the MN Geospatial Commons. Fills missing locations on existing parks.
- Booking links: generic ReserveMN/DNR links are flagged, with steps to paste the park's exact page once. Book now shows even before dates are set.
- Trip page: tabs (Plan, Gear, Checklist, Book, Weather, Trails, Debrief, Share), with readiness in the title line.
- Gear: product link, "Check price", and "Use this price" (records the date checked). No automatic price scraping (retailer terms, and blocked by browsers).

## Owner feedback round 2 (2026-09-27)
- Trip location now follows the campground picked in Book (replaces the old pin; a hand-set spot is kept only if the new campground has no pin). Plan tab has "Use <campground>'s location".
- Booking hand-off (no scraping/auto-booking): tapping Book now and coming back to the app shows "Back from booking?"; **Paste confirmation** reads a pasted ReserveMN/Recreation.gov email (confirmation #, site, arrival, nights, cost, fees, cancel-by) into the form for checking. Saving a booked reservation sets the trip's dates and marks the trip booked; a cancelled one moves a booked trip back to planned. Email layouts aren't published, so the parser looks for common labels. **Verify** against a real confirmation email and adjust `src/features/reservations/confirmation.ts` if a field is missed.
- Fixed: cost/fee and other decimal fields rejected cents on save (missing `step`); latitude/longitude fields used the iPhone decimal keypad, which has no minus key.

## Owner feedback round 3 (2026-09-27)
- **Home page season map**: every trip pinned (its own location, else its campground's); tap a pin to open the trip. Trips page map does the same.
- **Campground location lookup** (Book tab, automatic when a campground without a pin is picked; also "Find location" in the directory): state parks from the DNR park list (pin = middle of the park), national forest campgrounds from the USFS recreation sites service (`EDW_RecreationOpportunities_01`). Source and a verify note are saved on the campground.
- **Lake & fish tab** (new trip tab): public boat launches within ~6 mi from the DNR "Public Water Access Sites" dataset (nearest one fills the trip's boat launch if empty; directions link), and fish surveys from DNR LakeFinder for the chosen lake(s): share of all fish caught, fish per net by species per net type, average weight, and below/typical/above vs. the DNR's range for similar lakes. Cached on the phone (`lake_survey:<dow>`, `trip_nearby:<tripId>`) for offline use.
- `/api/gis` allowlist now also covers DNR LakeFinder (lake survey by DOW, lakes by point/name) and the USFS EDW MapServers.
- **Verify on the phone** (all unreachable from the build sandbox; each shows a per-source report if it fails): water access service address `enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/loc_water_access_sites` (named after the Commons dataset `loc-water-access-sites`, not confirmed), its field names (parsed loosely), LakeFinder `by_point` JSON shape and `detail.cgi?type=lake_survey` field names (taken from the DNR Sentinel Lakes R package), USFS recreation layer/fields.

## Open items / to verify

Owner:
- [ ] Complete README Azure steps 1–8 (+ optional 9 photos, 10 RIDB key); report the app URL.
- [ ] Door-jamb payload figure; owner's manual roof limit and towing section.
- [ ] Boat scale ticket (CAT scale) when possible; real people weights in Tools → Load & tow.
- [x] Offline maps: owner said keep the current approach (cache viewed tiles + capped "prepare offline" pass). Revisit if OpenFreeMap's terms turn out to forbid it.

Facts marked **verify** in the app (all research was via search summaries; official sites were blocked from the sandbox):
- [ ] MN state park booking rules (120 days / 8:00 AM CT / 14 nights / permit / fees) against dnr.state.mn.us / ReserveMN.
- [ ] Every campground in the directory (location, booking system, electric, boat launch, URLs, RIDB ids) — `docs/phase-3.md` lists sources.
- [ ] **Hinsdale Island (trip 4)**: the plan said USFS; research points to Kabetogama State Forest / MN DNR (contact via Soudan Underground Mine State Park). Confirm managing agency and site details.
- [ ] Norway Point (trip 5) dispersed site details.
- [ ] Recreation.gov booking windows per federal campground.
- [ ] MVUM layer source/licence (see above); the printed MVUM is always the legal reference.
- [ ] Gear prices/weights (research estimates) and vehicle specs.
