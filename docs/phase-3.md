# Phase 3 — Reservations

Campground directory, booking rules, booking-window countdowns, deep links and
booking tracking. Built on branch `worktree-agent-a540eb5ad16677c76` (a worktree
off `dev`, starting from commit `2dddc6d`).

## Important: this sandbox could not reach any of the official sources

Before writing any data, I tried to `WebFetch` every official domain named in
the brief — `dnr.state.mn.us`, `mndnr.gov`, `reservemn.usedirect.com`,
`fs.usda.gov`, `recreation.gov`, `ridb.recreation.gov` — and every one was
rejected by this sandbox's network egress proxy with a policy 403. I then
tested two unrelated control domains (`example.com`, `www.google.com`) with
plain `curl`, and those were rejected identically, which means the block is
this environment's general network policy, not something specific to
reservation sites. `WebSearch` (which runs outside this sandbox) does work, so
**every fact in this phase comes from WebSearch result summaries, not a direct
read of the official page**, and is cited by URL in the record's `source`
field. Per the brief's instruction for a blocked site, every affected
`status`/confidence field stays `verify` (nothing is marked `verified`), every
campground's `location` is left `null` with a note instead of a guessed
coordinate, and the RIDB facility ids for the two Recreation.gov campgrounds I
added are flagged for re-confirmation via the in-app RIDB search once a key is
set up. **Please re-verify this batch once you have real network access.**

## What's built

- **Model** (`src/model/reservations.ts`): added two optional fields per the
  brief's allowance — `windowMonths` on `bookingRule` and
  `windowMonthsOverride` on `campground` — so a calendar-month rolling window
  (Recreation.gov's "6 months out") can be represented and overridden per
  campground without breaking the existing day-count fields state parks use.
- **Pure logic** (`src/features/reservations/booking.ts`, 30 tests in
  `booking.test.ts`, all green): `bookingOpensAt`, `bookingState`,
  `resolveBooking` (the composite the UI actually calls),
  `campgroundTakesReservations`, `checkMaxNights`, `cancelDeadlineInfo`,
  `daysUntil`, `formatOpensAt`. All timezone math goes through a from-scratch
  `zonedTimeToUtc`/`localDate` pair (no new dependency) that re-derives the
  IANA zone's UTC offset at the actual instant, so it's correct across the
  March/November DST transitions — tests cross both boundaries in both
  `America/Chicago` (state park rule) and `America/New_York` (federal rule).
  - **Modeling note**: the brief's four fixed `booking_rule` ids are one per
    *agency*, but a single agency can run both reservable and first-come
    sites (e.g. Superior National Forest has both Recreation.gov campgrounds
    and free rustic ones). `campgroundTakesReservations` uses the
    **campground's own** `bookingSystem`, not just its agency's rule, to
    decide whether that specific site has a window at all — there's a
    regression test (`resolveBooking`) covering exactly this case. The
    campground's own `notes`/`verify` fields carry the site-specific facts;
    the agency `booking_rule` card hides its window/phone display for a
    non-reservable campground rather than showing a misleading number.
- **Screens** (`src/features/reservations/*.tsx`, wired into `routes.tsx`):
  - `/book` — every trip's campground, booking state, countdown, reservation
    status and the state-park permit, sorted action-needed first.
  - `/book/campgrounds` — search + filters (agency, booking system, electric,
    boat launch) over the directory, and an "Add" flow.
  - `/book/campgrounds/:id` — details, the agency rule (window/max
    nights/phone, hidden when this specific campground doesn't take
    reservations), verify flag, sources, editable day/month window override,
    "Book now" (`target="_blank" rel="noopener"`) or "No booking needed", and
    a full edit form. `/book/campgrounds/new` adds the RIDB search plus a
    manual form.
  - `/book/rules` — edit all four agency rules (every value, source, status).
  - `TripReservationSection({tripId})` — campground picker (writes
    `trip.campgroundId` via `saveRecord`, nothing else on the trip), booking
    state + countdown, Book now, a "set the official notify-me alert" note
    when waitlisted, the one `reservation:*` record's form (status,
    confirmation #, site #, cost, fees, cancel deadline with a days-left
    warning, notify-me checkbox, notes), a max-nights warning, and the state
    park permit note.
  - `BookingDashboardCard` — next up to 3 booking windows plus a link to
    `/book`.
  - `RidbImport` — the "Search Recreation.gov (RIDB)" widget; shows the
    proxy's own error message when the key is missing (503) or the phone is
    offline, verified in a browser smoke test (see below).
- **RIDB proxy** (`api/src/functions/ridb.ts`, `api/src/lib/ridbClient.ts`,
  18 tests total across both files): `GET /api/ridb/facilities` validates
  `query`/`state`/`limit`, requires the `family` role via the existing
  `authorize()`, calls the documented
  `https://ridb.recreation.gov/api/v1/facilities` with the `apikey` header
  from `RIDB_API_KEY`, trims each result to id/name/lat/lng/description/
  reservation URL, and returns a clear 503 with setup instructions when the
  key is absent — never an opaque failure. No new dependency; uses Node 22's
  built-in `fetch`.
- **Seeds** (`src/features/reservations/seed.ts`): 4 booking rules, 11
  campgrounds, 1 permit — see the table below. `npm test` includes the
  existing repo-wide seed check that nothing here is marked `verified`
  without independent confirmation.

## Every rule, with source and status

| Rule | Key facts | Status |
|---|---|---|
| `booking_rule:mn-state-park` | 120 days before arrival, opens 8:00 AM Central on release day then 24/7; every site needs a reservation; max 14 nights; $8 online/$10 phone fee, non-refundable; vehicle permit required separately; official "notify me" alert exists. | `verify` — WebSearch of dnr.state.mn.us/mndnr.gov (both blocked from this sandbox) |
| `booking_rule:mn-state-forest` | Individual/equestrian sites are first-come, first-served; since the DNR's Apr 2026 "same-day pay then stay" change, you pay through Yodel before occupying (doesn't reserve a specific site); group sites ARE reservable, 120 days out. | `verify` — WebSearch of dnr.state.mn.us and the DNR's Apr 13, 2026 news release (blocked) |
| `booking_rule:usfs` | Recreation.gov: 6-month rolling window, releases daily at 10:00 AM Eastern; window/max-nights vary by facility (e.g. some Chippewa NF sites need ≥4 days' notice) — override per campground; rustic/no-fee USFS sites are typically first-come with no Recreation.gov listing at all. | `verify` — WebSearch of recreation.gov and fs.usda.gov/r09/superior, /r09/chippewa (blocked) |
| `booking_rule:dispersed` | No booking, no fee; must be on an MVUM-designated road; not allowed inside the BWCAW; general 14-day stay limit. | `verify` — WebSearch of fs.usda.gov/superior and general USFS guidance (blocked) |

## Campgrounds seeded (11)

| Campground | Fits trip | Agency / system | Status |
|---|---|---|---|
| William O'Brien SP — Riverway Campground | 1: electric + boat launch near Roseville | mn-state-park / reservemn | `verify` |
| Wild River State Park Campground | 1 (alternative) | mn-state-park / reservemn | `verify` |
| Bear Head Lake SP Campground | 2: non-electric, on a lake, June | mn-state-park / reservemn | `verify` |
| McCarthy Beach SP — Beatrice Lake Campground | 2 (alternative) | mn-state-park / reservemn | `verify` |
| Wilson Lake Rustic Campground | 3: Superior NF rustic, lake + boat ramp, gravel forest roads | usfs / first-come | `verify` |
| Baker Lake Rustic Campground | 3 (alternative) | usfs / first-come | `verify` |
| Winnie Campground | 3 (alternative, reservable) | usfs (Chippewa NF) / recreation-gov | `verify`; RIDB id `233144` read from a recreation.gov URL, not the live API |
| Chippewa Loop — Norway Beach Recreation Area | electric + boat launch, Chippewa NF, Cass Lake | usfs / recreation-gov | `verify`; RIDB id `232150`, same caveat |
| Hinsdale Island Boat-in Campsites | 4: Lake Vermilion boat-in, free, first-come | **see note below** / first-come | `verify` |
| Norway Point (dispersed) | 5: Superior NF dispersed, St. Louis River | usfs / dispersed | `verify` |

**Correction to the brief:** Hinsdale Island is consistently described by
WebSearch results as managed within the state-run Kabetogama State Forest
(administered from Soudan Underground Mine State Park), not Superior National
Forest — recorded here as `mn-state-forest`, flagged in the record's `verify`
field, and called out here so the owner/coordinator can confirm the managing
agency once dnr.state.mn.us is reachable.

## Requests for coordinator

1. **RIDB API key.** Sign in at `ridb.recreation.gov`, generate a free key
   under your account, and add it as the `RIDB_API_KEY` app setting on the
   Azure Static Web App (Environment variables). No cost — it's a free,
   rate-limited public API key, nothing to approve. Without it, `/book/campgrounds/new`
   still works for manual entries; the RIDB search shows a clear "isn't set
   up yet" message instead of failing silently (see `api/src/functions/ridb.test.ts`).
2. **Re-verify this batch when you have network access.** Every rule and
   campground fact here came from WebSearch summaries because this sandbox's
   egress proxy blocked every official domain outright (confirmed against
   control domains too — see the top of this file). None of it is wrong on
   purpose, but none of it was read from the primary source either.
3. **Found in passing, not fixed (out of my ownership):** the standalone
   preview build (`npm run build:preview` → `scripts/build-preview.mjs`, a
   coordinator file) emits `dist-preview/camp-planner.html` with no
   `<meta charset="utf-8">`. When that file is opened or served without an
   explicit charset, browsers fall back to a legacy 8-bit encoding and every
   non-ASCII character (em dashes, curly quotes, the Dashboard's "·"
   separator) renders as mojibake, e.g. "William O'Brien State Park â€”
   Riverway Campground". The real deployed build (`dist/index.html`) already
   has the correct `<meta charset="UTF-8" />` and is unaffected. I tried to
   queue this as a follow-up task twice (`spawn_task` timed out both times)
   — flagging it here instead. Fix is a one-line addition to the HTML
   template in `scripts/build-preview.mjs`.
4. **`src/model/reservations.ts`** gained two optional fields
   (`windowMonths`, `windowMonthsOverride`) — allowed per `docs/CONTRACTS.md`
   ("may add optional fields"), documented above.

## Verification

- `npx tsc -b`, `npm test` (52 tests, all passing app-side), `npm run build`
  all pass from the repo root.
- `cd api && npm run build && npm test` passes (18 of 19 tests; the 19th is
  the existing SQL integration test, skipped without
  `TEST_SQL_CONNECTION_STRING`, unrelated to this phase).
- No jsdom/browser test runner exists in this repo (`vitest` runs with
  `environment: 'node'` everywhere, matching every other phase), so all 30
  `booking.ts` tests and the RIDB proxy's 18 tests are logic-level, per the
  brief's "pure, thorough tests" instruction. I additionally smoke-tested the
  actual UI: built `npm run build:preview`, served it statically, and drove
  it with headless Chromium — `/book`, `/book/campgrounds` (search + filters),
  a first-come campground's detail page ("No booking needed"), a reservable
  campground's detail page ("Book now" linking to the correct official URL,
  the rule card showing "120 days"/"866-857-2757"), `/book/rules`, and the
  "Add campground" RIDB-search flow (a clean "Search failed" message against
  the static preview, which has no `/api` backend). Zero console/page errors
  on any of those screens. I could not exercise `TripReservationSection` this
  way because Phase 2's trip screens are still a placeholder with no trips to
  open — it's covered indirectly by the same `booking.ts`/`data.ts` logic and
  follows the exact `useDraft`/`SpecEditor` patterns already used and
  screenshotted in `src/pages/Settings.tsx`.

## Risks / open items

- Every fact above needs a real read of the official page once this sandbox
  (or a future session) can reach it — see "Important" at the top.
- The two Recreation.gov facility ids were read from search-result URLs, not
  the live RIDB API — re-run the in-app "Search Recreation.gov (RIDB)" once a
  key exists and confirm they match.
- Hinsdale Island's managing agency needs a real confirmation (see the
  correction above).
