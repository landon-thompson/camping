# Lake recommender ("lakes to fish") — plan

From a campsite, rank lakes within 25 miles for one species, say **why** each lake lands where it does, show **how sure** we are, and work **offline** on the phone. Fitting happens in Python on a laptop or in GitHub Actions (CPU only); the phone only downloads small files and does arithmetic.

Status: plan + shared contracts (`src/features/lakerecs/types.ts`, `src/model/lakerecs.ts`) are on `dev`. Agents A–D build on separate branches from that commit; E reviews the integrated result.

---

## 1. What exists today (read before building)

| Area | Where | Notes for this feature |
|---|---|---|
| App | React 19 PWA, Vite, Tailwind 4, Dexie | Mobile-first, ≥44 px taps, day/night tokens (`bg-surface`, `text-ink`, `text-ink-2`, `border-line`, `text-brand`, `bg-warn-bg`). UI primitives in `src/components/ui.tsx`. |
| Local storage | `src/db/local.ts` (Dexie `records`, `meta`, `blobs`) | `records` **sync to the server** (≤256 KB each). `meta` is phone-only → model files go in `meta`, never in `records`. |
| Sync | `src/sync/engine.ts`, server `server/router.ts` + `server/d1Store.ts` (Cloudflare D1), `api/` (Azure, older) | Records are opaque JSON to the server, so a new record type needs **no server change**. |
| Fishing | `src/features/fishing/` | `lakeSurvey.ts` parses LakeFinder JSON (`detail.cgi?type=lake_survey`): per survey → per species/gear `cpue`, `gearCount`, `totalCatch`, `normalLow/High` (DNR's 25th–75th pct for similar lakes), `avgWeightLb` + weight quartiles. `SPECIES` code table. SD: `sdReport.ts` + `sdParse.ts` read GFP PDFs on the phone (catch per net by species/gear, no "similar lakes" range). |
| Lakes & launches | `src/features/places/waterAccess.ts`, `osm.ts`, `fishing/lakeList.ts`, `fishing/TripLakeSection.tsx` | Per trip: `trip_nearby:<tripId>` caches launches (DNR water access: name, water, DOW, ramp text, manager), LakeFinder nearby lakes, SD named waters (OpenStreetMap). 25-mile radius = `LAKE_RADIUS_KM` (40.2). `usableLaunch()` guards bad trip launches. |
| Trips | `src/model/trips.ts` | `startDate`, `endDate`, `location`, `campgroundId`, `boatLaunch`, `towing`. Trailer (`core.ts`) has weights only — no boat length or ramp needs. |
| Journal | `src/model/journal.ts` | Debriefs + photos. **No catch records** today → new `fishing_log`. |
| Hosting | Cloudflare Worker (`wrangler.jsonc`, `docs/CLOUDFLARE.md`), migration in progress; Azure still deploys `dev` | Static files from `dist/` (built from `public/`) are served free; Access protects them like the app. JSON is **not** precached by the service worker (`globPatterns`), which is what we want. |
| Tests | `npm test` (vitest, `src/**/*.test.ts`, `server/**/*.test.ts`), `npx tsc -b`, `npm run build` | `ml/` adds `pytest`. |

### Conflicts and constraints found

1. **Two survey parsers.** The app parses LakeFinder JSON (TS) and GFP PDFs (TS). The pipeline needs Python versions. Keep field meanings identical and add **parity fixtures** (same input → same numbers in `lakeSurvey.test.ts` and `ml/tests`).
2. **Model size vs. records.** Records sync and are capped at 256 KB; the model is megabytes statewide → `db.meta` keys `lakeModel:manifest`, `lakeModel:tile:<id>` (phone-only), downloaded per area.
3. **Public repo.** `landon-thompson/camping` is public. Family fishing logs (where and what we catch) **must never be committed** or uploaded to Actions. Refits that use them run locally from an exported file (gitignored). Published model files contain only public agency data.
4. **Gear units differ.** Gill net and trap net are fish per net; electrofishing is fish per hour. The index for each species is expressed in its primary gear; other gears inform it through gear offsets (model §4).
5. **No road network offline.** Drive time = straight-line distance × road factor ÷ speed (editable defaults), labeled "about".
6. **Launch fit has thin data.** Only the ramp text (concrete / gravel / carry-in / blank) and `trip.towing`. No boat-length field exists. Open question for the owner (§10).
7. **Regulations and seasons are facts.** Per CLAUDE.md: never invent them. Special regulations are quoted verbatim with source link and fetch date, or left out ("none found — statewide rules apply, check the booklet"). Season fit uses an **editable estimate table** labeled as such, not legal season dates.
8. **SD has no lake ids or "similar lakes" ranges.** SD lakes are keyed `sd:<slug>` (same slug as `sdReportId`). SD pooling uses lake features and region only, so SD estimates will lean on pooling and show lower confidence.
9. **Ownership rules (docs/CONTRACTS.md).** No new npm dependencies. Shared files (`schemas.ts`, `db/**`, `sync/**`, `.github/**`, `package.json`) are coordinator-owned; agents list needed changes instead of editing (exceptions granted in §8).
10. **Data source reachability.** The build sandbox can't reach DNR or GFP. Agent A builds and tests against recorded fixtures; the real download runs in GitHub Actions or locally. Endpoint shapes not seen live are marked `verify` in code and in the manifest `gaps`.

---

## 2. Data pipeline (Agent A, `ml/`)

### Sources (official/open only; polite)

| Data | Source | Notes |
|---|---|---|
| MN lake list, area, lat/long | LakeFinder `by_point` API over a grid covering MN (same endpoint the app uses), cross-checked with the DNR lakes layer on MN Geospatial Commons if reachable | Area/depth/clarity: take from LakeFinder survey JSON when present (`verify` field names); log gaps. |
| MN surveys | `maps.dnr.state.mn.us/cgi-bin/lakefinder/detail.cgi?type=lake_survey&id=<DOW>` | Catch per net by species and gear, gear counts, totals, normal ranges, avg weights, survey dates/types, **length distributions when present** (`verify` key). |
| MN stocking, special regulations | LakeFinder detail endpoints (`type=` values to be discovered from LakeFinder's own page; `verify`) | Regs quoted verbatim. If an endpoint can't be confirmed, skip and log a gap. Never paraphrase numbers. |
| MN public access | DNR Water Access Sites FeatureServer (`waterAccess.ts` URLs) | Paginated ArcGIS `query`, `f=json`. |
| SD lakes | OpenStreetMap named lakes (Overpass, ODbL: attribution in manifest + UI) + GFP Fishery Reports list per name | |
| SD surveys | GFP `ExportPDF.ashx?ReportID=` PDFs, parsed with `pdfplumber` | Same rules as `src/features/fishing/sdParse.ts`. |
| SD launches | GFP GIS (`gfpgis.sd.gov`, layer found by name, `verify`) + OSM slipways | |

Rules: identify with a User-Agent naming the app; **≤1 request/second per host**, exponential backoff on 429/5xx; cache every raw response under `ml/cache/<source>/…` (gitignored; persisted in Actions with `actions/cache`); `--offline` re-runs from cache only. No scraping of reservation sites, onX or Gaia.

### Output: tidy tables (`ml/data/tidy/`, Parquet, gitignored; schema in `ml/lakerecs/schema.py`)

`surveys.parquet` — one row per **lake × species × survey × gear**:

| column | type | meaning |
|---|---|---|
| `lake_key` | str | `mn:<DOW>` / `sd:<slug>` |
| `state` | str | MN / SD |
| `species` | str | DNR code (SD names mapped with the app's `codeForName` rules) |
| `survey_id` | str | stable id (date+type, or GFP ReportID) |
| `survey_date` | date | |
| `survey_type` | str | e.g. "Standard Survey", "Population Assessment" |
| `gear` | str | raw gear text |
| `gear_family` | str | gill / trap / electro / seine / other (same rules as `gearFamily()`) |
| `effort` | float? | nets (gearCount) or hours; null if unknown |
| `total_catch` | int? | |
| `cpue` | float? | as published |
| `normal_low`, `normal_high` | float? | DNR similar-lake quartiles (MN only) |
| `avg_weight_lb`, `normal_weight_low`, `normal_weight_high` | float? | |
| `lengths` | list[struct{inch:int,count:int}]? | length distribution when published |
| `source_url` | str | page or PDF the row came from |
| `parse_source` | str | `lakefinder-json` / `gfp-table` / `gfp-summary` |

`lakes.parquet` — `lake_key, state, name, county, lat, lng, area_acres, max_depth_ft, clarity_ft, region` (MN: DNR fisheries region or ecoregion; SD: GFP region if found, else a coarse lat/lng cell), `source_url`.
`launches.parquet` — `lake_key, name, lat, lng, ramp, ramp_class, source`.
`stocking.parquet` — `lake_key, year, species, count, size, source_url`.
`regs.json` — `{lake_key: [{species|null, text, url, fetchedAt}]}`.
`gaps.json` — counts and examples of everything missing or unparseable, by source.

---

## 3. Model (Agent B, `ml/`, NumPyro on CPU)

For lake *l*, species *s*, survey *k*, gear *g*:

- Observation: `total_catch ~ NegBinomial(mean = effort · exp(θ_ls + γ_sg + δ_lsk), dispersion φ_sg)`. When only `cpue` is published (no effort), use a log-normal on `cpue` with the same mean structure and gear-specific σ.
- Gear offsets `γ_sg`: species-specific log-ratio of each gear to the species' primary gear (primary gear has γ = 0).
- Latent quality (log-index, 0 = typical lake): `θ_ls ~ Normal(μ_ls, τ_s)`, with `μ_ls = α_{s,group(l)} + β_s · features_l` (log area, log depth, clarity, standardized).
  - **Partial pooling toward similar lakes.** MN: DNR's `normal_low/high` for that lake-species-gear defines the similar-lake prior centre (log of the quartile midpoint, relative to the species' state typical) with spread from the quartile width. Where absent (and in SD), groups are feature clusters × region.
- **Time decay.** `δ_lsk ~ Normal(0, σ_drift,s · sqrt(age_years_k))`: older surveys are noisier evidence about *today*, so they count less automatically. Report the implied half-weight age per species.
- Priors weakly informative; non-centered parameterization.
- Inference: NUTS (default) with a `--fast` SVI mode for tests. CPU only; must finish on a GitHub-hosted runner (~2 cores) in < 60 min for MN+SD.
- Size: `sizeIndex` = shrunken ratio of avg weight to the similar-lake typical (simple empirical-Bayes), shown as a factor, not part of θ.

**Outputs per lake × species:** median, p10, p90 of θ; 200 posterior samples (sorted, quantized); evidence `{surveys, latestYear, ownWeight, sources}`. `ownWeight` = 1 − (posterior var of θ ÷ prior var of θ given the pooling model), clipped to 0–1.

**Validation:** hold out every lake's most recent survey (one refit), predict it with the posterior predictive (including observation noise), and report 50%/80% interval coverage overall and per species, plus CRPS on log-CPUE against a baseline (DNR similar-lake midpoint; state median for SD). Written to `ml/reports/validation.json` and summarized in `manifest.validation`. Calibration target: 80% intervals contain 75–85% of held-out surveys.

### Export format (exact TS types: `src/features/lakerecs/types.ts`)

- `public/lake-model/manifest.json` — version, species list with primary gear and state typical CPUE, tile list with bbox/bytes/sha256, validation summary, sources with terms, gaps.
- `public/lake-model/tiles/t_<south>_<west>.json` — 0.5° lat × 1° lng cells. Per lake: name, position, features, launches, regs, stocking, and per species `{med, p10, p90, q, evidence, sizeIndex}`.
- **Sample compression:** 200 samples of θ, sorted ascending, quantized to one byte on the tile's per-species `[lo, hi]`, delta-encoded (first byte absolute, then non-negative differences), base64. ~270 characters raw per lake-species, much less after the server's gzip/brotli (deltas are small, repetitive bytes). Quantization error ≤ (hi − lo)/255, about 0.02 in log-index.
- Only game species with ≥1 survey anywhere get estimates (walleye, northern pike, yellow perch, black crappie, bluegill, largemouth bass, smallmouth bass, muskellunge, plus trout/others if data allow).
- **Payload budget:** ≤ 300 KB compressed for one trip area (the tiles touching a 25-mile circle, usually 2–4); whole MN+SD set ≤ 8 MB in the repo. The exporter prints the sizes; the final numbers go in PROGRESS.md.

### Publishing

`.github/workflows/lake-model.yml` (monthly + manual): restore `ml/cache`, fetch (rate-limited), build tidy tables, fit, validate, export to `public/lake-model/`, then open a PR (`gh pr create` with `GITHUB_TOKEN`, permissions `contents: write`, `pull-requests: write`) containing the files and the validation report. Merging the PR to `dev` deploys the files with the app. Public data only. Note: PRs opened by `GITHUB_TOKEN` don't trigger the CI workflow; run it manually or re-push.

Local: `cd ml && python -m lakerecs fetch && python -m lakerecs fit && python -m lakerecs export` (see `ml/README.md`). A refit with the family log uses `--journal ~/Downloads/fishing-log.json` (exported from the app) and writes to `ml/out/` (gitignored). Never commit it.

---

## 4. On-device ranking and explanations (Agent C, `src/features/lakerecs/`, TypeScript)

Files: `modelStore.ts` (download/cache/refresh), `decode.ts` (samples), `rank.ts` (scoring + modes), `explain.ts` (reasons, weak spots, comparison, confidence), `familyLog.ts` (conjugate update), `weights.ts` (editable defaults), tests next to each.

**Model storage.** `db.meta`: `lakeModel:manifest` and `lakeModel:tile:<id>`. `ensureTilesFor(origin, radiusKm)` downloads the tiles a 25-mile circle touches (and verifies sha256). `refreshLakeModel()` runs when online and on each successful sync (subscribe to the sync status rather than editing the engine): if `manifest.version` changed, refetch the tiles already on the phone. Offline: everything works from what's cached; missing tiles are reported (`missingTiles`).

**Candidate lakes.** Lakes in cached tiles within `radiusKm` (default 40.2) of the origin with at least one launch; if towing, at least one launch that isn't `carry-in`. Excluded lakes are listed with the reason.

**Score** (points; all weights in `weights.ts`, documented, editable later in Settings):

| Term | Default | Text example |
|---|---|---|
| fish | `10 × log2(index)` (+10 per doubling vs. a typical lake), index from the mode below | "About 1.8× the walleye of a typical lake" |
| drive | `−1 per 5 min` one-way beyond 10 min; drive = km × 1.35 ÷ 70 km/h | "About 25 min away" |
| launch | concrete 0, gravel −2, unknown −3, carry-in −15 (0 when not towing) | "Gravel ramp" |
| season | species × month estimate table, −5…+5, labeled *estimate* | "Early June is usually good for walleye (estimate)" |
| family | +0…+4 from past outing ratings at this lake | "You rated it 5/5 last time" |

**Modes.** Safe bet uses p10, Best expected uses the median, Adventurous uses Thompson sampling: draw one posterior sample per lake with a seeded RNG (seed fixed per day, "Roll again" changes it), so uncertain-but-promising lakes sometimes rise.

**Family log update (on device).** For lake *l*, species *s*: moment-match the posterior samples of `exp(θ)` to a Gamma(a, b); each outing gives `count ~ Poisson(hours · r_s · exp(θ))`, where `r_s` is fish per hour at a typical lake for a family angling party (editable estimate in `weights.ts`, labeled *estimate*). Conjugate update: `a += w·count`, `b += w·hours·r_s` with tempering `w = 0.5` (angler catch is a noisier, biased view of survey abundance). Summaries (p10/med/p90) come from the updated Gamma; samples are reweighted by the same likelihood (importance weights) for Thompson mode. Zero-catch outings for target species count. Logs sync as records; refits that include them are local only (§3).

**Explanations per lake.** Top 2–3 reasons (largest positive terms, in words); per-factor point breakdown; weak spots (low confidence, latest survey > 8 years old, mostly pooled, carry-in or unknown ramp, long drive, estimate based on another gear, special regulation present); comparison with the next lake ("Beats #3 mainly on walleye (+6 pts) despite 12 more minutes of driving"); confidence label from evidence:
- **High**: ownWeight ≥ 0.6, ≥ 2 surveys, latest ≤ 6 years old, p90/p10 ≤ 4×.
- **Medium**: ownWeight ≥ 0.3 and latest ≤ 12 years old.
- **Low**: otherwise ("mostly based on similar lakes").
Links to the source surveys (LakeFinder page / GFP report list).

**API** (types in `types.ts`): `recommendLakes(ctx: RecContext, data: {tiles, logs}): RecResult` (pure, synchronous, testable) plus `useLakeRecs(ctx)` hook that loads tiles and logs from Dexie.

## 5. UI (Agent D, `src/features/lakerecs/*.tsx`)

- **Where.** A "Best lakes" card at the top of the trip's Lake & fish tab (`TripLakeSection`, one-line insert) and a "Recommend" panel in Tools › Fishing with a campsite picker (trip, campground, or map point).
- Species picker (chips with `FishIcon`), mode toggle (Safe bet / Best expected / Adventurous + Roll again), ranked list: rank, name, drive, a **range bar** (p10–p90 with the median tick, on a log scale with "typical" marked), confidence chip, one-line top reason.
- Lake detail (sheet or route `/tools/fishing/lake/:key`): "Why #N?" factor breakdown with points, plain explanation of the range ("We'd expect 0.9–3.1× a typical lake; middle guess 1.7×. Wide because the last survey was 2014."), weak spots, vs. next lake, regulations (verbatim + link) or "None found — statewide rules apply", stocking, launch on the existing `TripMap` (works offline for tiles you viewed), source survey links, "Log a catch" form (creates a `fishing_log`).
- Model status line: version, date, "Update model" when online, "Download lakes for this trip" when tiles are missing, and a clear offline state.
- Match existing styling; test at 390 px width and with the network off.

## 6. Review + tests (Agent E)

Unit tests for decode, scoring, modes (seeded Thompson), explanations, confidence, family-log update (posterior moves the right way, zero catches lower it, tempering), offline loading from Dexie (fake-indexeddb); fixture tiles in `src/features/lakerecs/fixtures/`; end-to-end check of a sample trip (Bear Head–area fixture) at 390 px with the network blocked; Python tests for parsers, schema, export round-trip (Python encode ↔ TS decode parity via a shared fixture), and validation code. Review all branches for correctness, offline behaviour, payload size, rule compliance (no invented regs/seasons, public data only), then report issues.

## 7. Agent task split and branches

| Agent | Branch | Owns | Depends on |
|---|---|---|---|
| A — data pipeline | `lakerecs/a-data` | `ml/lakerecs/{fetch,sources,parse_*,tidy,schema}.py`, `ml/tests/test_*data*`, `ml/fixtures/raw/**`, `ml/README.md` (data part), `ml/requirements*.txt` | plan only |
| B — model | `lakerecs/b-model` | `ml/lakerecs/{model,validate,export,encode}.py`, `ml/tests/test_*model*`, `.github/workflows/lake-model.yml`, demo output in `ml/fixtures/demo-model/` only | the §2 schema (builds a synthetic generator against it, so it can start in parallel) |
| C — engine | `lakerecs/c-engine` | `src/features/lakerecs/*.ts` (not `types.ts`), `fixtures/` | `types.ts` (exists) |
| D — UI | `lakerecs/d-ui` | `src/features/lakerecs/*.tsx`, one-line inserts in `TripLakeSection.tsx` and `FishingPage.tsx`, a route in `features/gear/routes.tsx` | `types.ts`; C's functions (stubs in its own branch until C lands, swapped at integration) |
| E — review/tests | `lakerecs/e-review` (from the integration branch) | tests anywhere, review notes | A–D merged into `lakerecs/integration` |

All start from the `dev` commit that adds this plan. Each opens one PR into `dev`. Coordinator merges A–D into `lakerecs/integration` for E, applies E's fixes via the owning agent, then hands the PRs to the owner in order **C → D → A → B** (app first; the model files don't change app behaviour until present).

**Demo data never ships.** The sandbox can't reach DNR/GFP, so agents use fixtures. Fixture lakes are named `Fixture Lake …` with synthetic numbers and live only under `ml/fixtures/` and `src/features/lakerecs/fixtures/`. `public/lake-model/` is written only by a real run (Actions or local with network). With no manifest published, the app says "Lake model not published yet".

## 8. Shared-file exceptions granted

- `src/model/schemas.ts`: `fishing_log` already registered by the coordinator.
- `.github/workflows/lake-model.yml`: new file, Agent B.
- `.gitignore`: coordinator adds `ml/cache/`, `ml/data/`, `ml/out/`, `ml/.venv/`.
- No changes to `server/**`, `api/**`, `wrangler.jsonc`, `db/local.ts` schema version, or the sync engine.

## 9. Size and cost

- Phone: ≤ 300 KB compressed per trip area, stored in IndexedDB; the manifest is a few KB per check.
- Repo: ≤ 8 MB for the published model; older versions live in git history only.
- Cost: $0. GitHub Actions minutes are free for public repos; Cloudflare static files are free; Python packages are open source and only run in CI or on a laptop.

## 10. Open questions for the owner

1. Boat and trailer: length, and whether gravel or shallow ramps are OK, to make launch fit real (today: ramp type only).
2. Should the family log ever leave the phones for refits beyond a local export (it's public-repo-unsafe by design today)?
3. Which species matter most (the picker order)?
4. Drive speed and how much an extra 10 minutes "costs" against a better lake.
