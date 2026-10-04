# Camp Planner — notes for Claude

Family camping/overland trip planner (2 adults + toddler, Minnesota + South Dakota, 2027 season, Lexus GX550). Built in review-gated phases; **read `docs/PROGRESS.md` first** for status, the owner's answers, and open items. The owner later asked for all remaining phases to be built in parallel (see `docs/CONTRACTS.md` for ownership and integration slots).

## Layout
- `src/`: React PWA (Vite, Tailwind 4, Dexie). `model/*.ts` define every record type (registry in `model/schemas.ts`); `features/<gear|trips|reservations|trails|journal>/` hold each phase's screens, logic, seeds and tests; `calc/` the pure calculators; `sync/` the local-first sync engine.
- `server/` + `wrangler.jsonc`: the Cloudflare Worker (current hosting, `docs/CLOUDFLARE.md`; `dist/` served as static assets, `server/worker.ts` handles `/api/*`): Access JWT check (`access.ts`), D1 store (`d1Store.ts`), routes (`router.ts`). Reuses the runtime-neutral libs in `api/src/lib` (keep those free of Node-only APIs).
- `api/`: Azure Functions (Node 22, TS, CommonJS), the original hosting. `lib/store.ts` (interface + MemoryStore), `lib/sqlStore.ts` (Azure SQL), `lib/migrations.ts`.
- `public/_headers` (Cloudflare) and `public/staticwebapp.config.json` (Azure SWA routes/roles).
- `.github/workflows/ci-deploy.yml`: tests (incl. SQL Server service container), then deploys `dev` to Azure if `AZURE_STATIC_WEB_APPS_API_TOKEN` exists.

## Commands
- App + Cloudflare server: `npm test` (includes `server/` tests on node:sqlite), `npm run build` (runs `tsc -b`), `npm run dev`
- API: `cd api && npm test && npm run build`. Set `TEST_SQL_CONNECTION_STRING` to run the SQL integration test (see README).

## Rules
- Work on branch `dev`.
- Never invent facility locations, rules, fees or booking windows. Use official sources or mark them `verify`. Keep rules, limits and weights as editable data (`SpecNumber` with status), never constants.
- No auto-booking or scraping of reservation sites, onX or Gaia. Deep links plus our own tracking only. Only official/open data and the owner's own GPX/KML files.
- Mobile-first: tap targets ≥ 44px (`min-h-11`/`min-h-12`), high-contrast day theme, dim night theme.
- Keep dependencies minimal. Explain any paid service before adding it; the owner wants to know about every cost.
- New entity types: add a zod schema to `recordSchemas`. Keep records fine-grained (one checklist item = one record) to avoid sync conflicts. Seeds use fixed IDs and `updatedAt: 0`.
