# Lake recommender pipeline (`ml/`)

Python side of the "lakes to fish" recommender (plan: `docs/LAKE_RECS_PLAN.md`). Runs on a laptop or in GitHub Actions, CPU only. Nothing here ships to the phone except the model files the exporter writes.

## Data

Public agency and open data → raw cache → tidy tables. Plan §2; schema as code in `lakerecs/schema.py`.

### Setup

```sh
cd ml
python3 -m venv .venv && . .venv/bin/activate     # Python 3.11+
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```

All packages are free and open source; no paid service, no API key.

### Commands

Run from `ml/`:

| Command | What it does |
|---|---|
| `python -m lakerecs fetch` | Downloads and caches every raw response under `ml/cache/<source>/` (≤ 1 request/second per host). Re-running only refetches what is older than its freshness window (`sources.MAX_AGE_DAYS`; GFP PDFs never). |
| `python -m lakerecs tidy` | Builds the tidy tables in `ml/data/tidy/` from the cache only (never touches the network), validates them against the schema, and writes `gaps.json`. |
| `python -m lakerecs all` | `fetch`, then `tidy`. |

Options (any command): `--state MN|SD|both`, `--limit N` (first N lakes per state, for smoke runs), `--bbox=W,S,E,N` (use the `=` form: the value starts with a minus sign), `--offline` (cache only; `fetch --offline` reports what is missing), `--cache DIR`, `--out DIR`, `--fixtures DIR` (serve the synthetic fixture files instead of the network), `--sd-reports N` (newest GFP survey PDFs per SD lake, default 3), `--sd-min-acres A` (default 10), `--grid-km K` (LakeFinder grid spacing, default 28), `--lf-stocking-type T` / `--lf-regs-type T` (LakeFinder `detail.cgi?type=` values; default: discovered, `''` to skip), `--max-retries N`.

Smoke run around one area: `python -m lakerecs all --state MN --limit 20 --bbox=-92.3,47.6,-91.6,48.0`

Time and size (estimates, verify on the first real run): the MN lake list is about 530 grid requests (~9 min); MN surveys are one request per lake (LakeFinder lists many thousands of named basins, so the first full run takes hours; later runs reuse the cache for 60 days); SD is ~30 Overpass requests plus one or two GFP list pages and up to 3 PDFs per lake. The raw cache is persisted between Actions runs with `actions/cache`.

### Sources (official/open only)

| Data | Source | Cache folder |
|---|---|---|
| MN lake list | LakeFinder `by_point` API over a grid covering MN (de-duplicated by DOW; a cell is split when an answer looks capped) | `mn-lakefinder` |
| MN surveys, lake features | LakeFinder `detail.cgi?type=lake_survey&id=<DOW>`; a sub-basin without its own net results uses the whole lake's survey (`lakes.parent_key`) | `mn-lakefinder` |
| MN stocking, special regulations | LakeFinder `detail.cgi?type=<discovered>` (type names found in LakeFinder's own lake page and scripts; skipped and logged if not found) | `mn-lakefinder` |
| MN public water access | DNR Water Access Sites FeatureServer (paginated ArcGIS `query`, `f=json`) | `mn-water-access` |
| SD lakes | OpenStreetMap named `natural=water` (Overpass, 1° tiles; area from the outline) | `osm-overpass` |
| SD surveys | GFP Fishery Reports list per lake name (`"X Lake"`, then `"X"`) → newest survey PDFs → pdfplumber | `sd-gfp-reports` |
| SD launches | GFP GIS ramp layer (found by name) + OSM `leisure=slipway` | `sd-gfp-gis`, `osm-overpass` |

The client (`lakerecs/http.py`) sends `User-Agent: CampPlanner/1.0 (family trip planner; github.com/landon-thompson/camping)`, waits ≥ 1 s between requests to the same host, backs off exponentially on 429/5xx/network errors (2, 4, 8, … s, honouring `Retry-After`), and times out every request. Every response is written to the content-addressed cache before it is parsed: bodies under `<source>/blobs/<sha256>`, the request → body mapping under `<source>/req/`. If a refetch fails, the stale cached copy is used. No reservation sites, onX, Gaia, or scraping beyond these endpoints.

OpenStreetMap data is © OpenStreetMap contributors, ODbL 1.0; the attribution is in `sources.json` and must appear in the manifest and the UI.

### Parsers mirror the app

| Python | App (TypeScript) | Parity test |
|---|---|---|
| `parse_lakefinder.parse_lake_survey`, `parse_nearby_lakes`, `gear_family` | `src/features/fishing/lakeSurvey.ts` | `tests/test_data_lakefinder.py` (same JSON and numbers as `lakeSurvey.test.ts`) |
| `parse_gfp.parse_survey`, `pdf_lines` | `sdParse.ts`, `sdPdf.ts` | `tests/test_data_gfp.py` (same PDF and lines as `sdParse.test.ts`) |
| `parse_gfp.parse_report_links`, `survey_links`, `water_name_variants`, `sd_slug` | `api/src/lib/sdFishReports.ts`, `sdReport.ts` (`sdReportId`) | `tests/test_data_gfp.py` |
| `parse_arcgis.*` | `places/arcgis.ts`, `places/waterAccess.ts` | `tests/test_data_arcgis_osm.py` |
| `parse_osm.*` | `places/osm.ts` | `tests/test_data_arcgis_osm.py` |
| `species.py` | `SPECIES`, `codeForName` (lakeSurvey.ts), `SD_SPECIES` (sdParse.ts) | `tests/test_data_species.py` reads the TS tables and compares |

Deliberate differences: text with no digits (`"N/A"`) is null, not 0 (the TS `Number('')` quirk); SD "Frame nets" are gear family `trap` (sdParse already groups frame and trap nets).

### Output: `ml/data/tidy/` (gitignored)

| File | One row per | Columns |
|---|---|---|
| `surveys.parquet` | lake × species × survey × gear | `lake_key, state, species, survey_id, survey_date, survey_year*, survey_type, gear, gear_family, effort, gear_count*, effort_source*, total_catch, cpue, normal_low, normal_high, avg_weight_lb, normal_weight_low, normal_weight_high, lengths, source_url, parse_source` |
| `lakes.parquet` | lake | `lake_key, state, name, county, lat, lng, area_acres, max_depth_ft, clarity_ft, region, source_url, parent_key*` |
| `launches.parquet` | launch | `lake_key, name, lat, lng, ramp, ramp_class, source` |
| `stocking.parquet` | stocking event | `lake_key, year, species, count, size, source_url` |
| `regs.json` | | `{lake_key: [{species, text, url, fetchedAt}]}`, text verbatim |
| `gaps.json` | | `{bySource: {source: {kind: {count, examples}}}, summary: [plain sentences], verify: [unconfirmed endpoints/fields]}` |
| `sources.json` | | `[{name, url, terms, fetchedAt}]` for the manifest |

`*` = additions beyond the plan, optional in the schema (a frame without them validates). Types and rules: `lakerecs/schema.py` (`validate_frame(df, "surveys")`, `read_tidy(dir)`, `validate_tidy(tables)`).

Field notes:
- `lake_key`: `mn:<8-digit DOW>` or `sd:<slug>` (slug = `sdReportId`'s). SD lakes with the same name: the largest is kept, the rest are logged.
- `survey_id`: MN `"<date>|<type>"`; SD the GFP ReportID. `survey_date` is null when only a year is published (most SD reports); `survey_year` is always set.
- `effort`: the denominator of the published CPUE. Nets: `gearCount`. Electrofishing: hours = `totalCatch / CPUE` (LakeFinder's `gearCount` there is not hours), shared with zero-catch rows of the same survey. SD: null (GFP summaries publish CPUE only).
- `region`: `MN:<LakeFinder region>` when the survey JSON has one, else a 1° cell `MN:cell:47_-94` / `SD:cell:44_-98`.
- `ramp_class`: first matching rule in `parse_arcgis.RAMP_RULES` (editable): carry-in, then concrete (any hard surface: concrete, plank, bituminous…), then gravel (gravel, natural, dirt…), else unknown.
- Regulations: quoted verbatim (markup stripped) with the lake's LakeFinder page and fetch time, or absent. Nothing is paraphrased or inferred.

### Not confirmed from the build sandbox (`verify`)

The sandbox can't reach DNR, GFP or OSM, so these are written against the app's code and recorded-shape fixtures; the list is also written to `gaps.json → verify`:

- LakeFinder `by_point`: maximum radius and whether answers are capped (`sources.LF_RESULT_CAP`).
- LakeFinder `lake_survey`: keys for area / max depth / clarity / region (matched loosely), and the length-distribution key and shape (any survey key containing "length").
- LakeFinder stocking and special-regulation `type=` values and their JSON shapes.
- DNR water access attribute names (matched by pattern like the app).
- GFP GIS ramp layer (found by name), and whether `?Waterbody=` lists reports of several same-named lakes.
- SD state membership near borders (box test) and OSM-derived areas.

### Fixtures

`fixtures/raw/` holds synthetic recorded-shape responses for a fake region (26 MN basins, 8 SD lakes; all named "Fixture …", DOWs 99xxxxxx), generated by `fixtures/make_raw.py`. `fixtures/tidy/` is the pipeline's output for them (committed, small). Regenerate both:

```sh
python fixtures/make_raw.py
python -m lakerecs tidy --fixtures fixtures/raw --out fixtures/tidy
```

Tests fail if either is stale.
