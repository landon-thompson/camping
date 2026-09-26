# Progress & decisions

This file is the hand-off note between work sessions. Update it at the end of every phase.

## Status

**2026-09-26 — owner asked to build all remaining phases in parallel.** The coordinator set up shared contracts (`docs/CONTRACTS.md`) and launched one Sonnet agent per phase (1–5), each in its own git worktree/branch. The first attempt hit the usage limit before any code landed; relaunched 18:21 UTC. Next: merge each phase branch into `dev`, integrate, test end-to-end, polish/accessibility pass, update README + preview.

| Phase | Scope | Status |
|---|---|---|
| 0 – Foundation | Scaffold, auth, DB schema + migrations, PWA shell, deploy pipeline, README | **Done, awaiting owner review.** Azure resources not created yet (owner follows README steps 1–8) |
| 1 – Gear, checklists, calculators | Gear CRUD + category budgets, load/tow + power calculators with tests, checklist templates | Calculators + tests done (coordinator); UI in progress (agent) |
| 2 – Trips & map | Season map (MapLibre + OpenFreeMap), trip pages, gear/checklists per trip, readiness score, read-only share link | In progress (agent) |
| 3 – Reservations | Campground directory (MN DNR + RIDB), booking-window countdowns (no reminders: owner declined), deep links, booking tracking | In progress (agent) |
| 4 – Trails & offline | onX GPX/KML import **and export**, MVUM layer, pins, route flags, offline map region download | In progress (agent) |
| 5 – Weather, journal, polish | NWS forecasts, debriefs with photos feeding checklists, accessibility pass | In progress (agent) |

Work happens on the **`dev`** branch. Pushes to `dev` deploy to Azure once the deploy secret exists.

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

## Open items / to verify

- [ ] Owner: complete README Azure steps 1–8; report the app URL.
- [ ] Owner: door-jamb payload figure; owner's manual roof limit and towing section.
- [ ] Owner: boat scale ticket (CAT scale) when possible.
- [ ] Phase 2: confirm OpenFreeMap tile terms allow offline caching of a trip region before building offline maps.
- [ ] Phase 3: verify MN DNR booking rules against the official site; get a RIDB API key (free) → store as `RIDB_API_KEY` env var.
- [ ] Phase 4: confirm the USFS MVUM GIS source and license.
