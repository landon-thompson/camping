# Fixtures: synthetic only

Nothing here is real data. Every lake is invented ("Fixture Lake …", DOW numbers 99xxxxxx, GFP report ids 9001xx, OSM ids 9000000xx) and every number comes from a seeded random generator. Regulation texts say "FIXTURE TEXT (synthetic, not a real rule)".

- `raw/`: recorded-shape responses (LakeFinder JSON, ArcGIS JSON, Overpass JSON, GFP list pages and PDFs) plus `index.json` mapping each request to its file. Written by `make_raw.py`; don't edit by hand (a test regenerates it and compares).
- `tidy/`: the tidy tables the pipeline builds from `raw/` (`python -m lakerecs tidy --fixtures fixtures/raw --out fixtures/tidy`).

Shapes follow the app's parsers and tests. Keys never seen live (lake features, length distributions, stocking, regulations, the GFP ramp layer) are guesses, marked `verify` in `lakerecs/sources.py`.

What the region covers: surveys over decades, gill-net-only and electrofishing-only surveys, species missing from some lakes, a sub-basin that uses the whole lake's survey, CPUE-only rows (no effort), an undated survey, an unparseable answer, lakes with no survey, a lake with no position, a broken PDF, a summary-sentence-only report, a lake found only under its bare name, a species without a DNR code, duplicate and unmatched launches.
