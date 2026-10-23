"""End to end: fixture files -> cache -> tidy tables, through the CLI."""

import filecmp
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from lakerecs import schema
from lakerecs.cli import main
from lakerecs.fetch import Gaps, Options, collect, grid_points, radius_m, tiles
from lakerecs.http import Client, FixtureTransport

ML = Path(__file__).resolve().parents[1]
RAW = ML / "fixtures/raw"
TIDY = ML / "fixtures/tidy"


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("tidy")
    cache = tmp_path_factory.mktemp("cache")
    assert main(["fetch", "--fixtures", str(RAW), "--cache", str(cache)]) == 0
    assert main(["tidy", "--fixtures", str(RAW), "--cache", str(cache), "--out", str(out)]) == 0
    return {"out": out, "cache": cache, "t": schema.read_tidy(out)}


def test_committed_tidy_fixtures_are_up_to_date(built):
    """Re-run `python -m lakerecs tidy --fixtures fixtures/raw --out fixtures/tidy` if this fails."""
    want = schema.read_tidy(TIDY)
    for name in schema.TABLES:
        pd.testing.assert_frame_equal(built["t"][name], want[name], obj=name)
    for name in ("regs", "gaps", "sources"):
        assert built["t"][name] == want[name], name


def test_raw_fixtures_regenerate_identically(tmp_path):
    """fixtures/raw is exactly what fixtures/make_raw.py writes (no hand edits, no drift)."""
    out = tmp_path / "raw"
    subprocess.run([sys.executable, str(ML / "fixtures/make_raw.py"), str(out)], check=True, capture_output=True)
    cmp = filecmp.dircmp(RAW, out)

    def diffs(c):
        bad = c.left_only + c.right_only + c.diff_files
        for sub in c.subdirs.values():
            bad += diffs(sub)
        return bad

    assert [d for d in diffs(cmp) if d != "README.md"] == []


def test_every_request_had_a_fixture():
    ft = FixtureTransport(RAW)
    c = Client(RAW.parent / "_unused", transport=ft, sleep=lambda s: None)
    c.cache.put = lambda *a, **k: None  # don't write anything
    c.cache.get = lambda *a, **k: None
    gaps = Gaps()
    collect(c, Options(state_bbox={k: tuple(v) for k, v in ft.meta["bbox"].items()}), gaps)
    # Only the deliberate 404 (Fisheries folder not public) is missing.
    assert ft.misses == ["https://gfpgis.sd.gov/arcgis/rest/services/Fisheries?f=json"]


def test_lakes(built):
    lakes = built["t"]["lakes"].set_index("lake_key")
    assert (lakes["state"] == "MN").sum() == 26 and (lakes["state"] == "SD").sum() == 8
    assert lakes.loc["mn:99051501", "parent_key"] == "mn:99051500"  # sub-basin
    assert lakes.loc["mn:99051500", "parent_key"] is pd.NA
    assert lakes.loc["mn:99092700", "lat"] > 47  # India: position from its launch (no point in LakeFinder)
    alpha = lakes.loc["mn:99010300"]
    assert (alpha["area_acres"], alpha["max_depth_ft"], alpha["clarity_ft"]) == (5210.4, 78.0, 11.5)
    assert alpha["source_url"] == "https://www.dnr.state.mn.us/lakefind/lake.html?id=99010300"
    assert lakes.loc["sd:fixture-lake-granite", "area_acres"] > 2000  # multipolygon minus the island
    assert pd.isna(lakes.loc["sd:fixture-lake-amber", "max_depth_ft"])
    assert lakes.loc["sd:fixture-lake-amber", "source_url"].startswith("https://apps.sd.gov/GF56FisheriesReports/?Waterbody=")
    assert lakes.loc["sd:fixture-lake-elm", "source_url"].startswith("https://www.openstreetmap.org/way/")
    assert "sd:fixture-pond-tiny" not in lakes.index and "sd:fixture-creek" not in lakes.index
    assert lakes["region"].str.match(r"^(MN|SD):cell:\d+_-\d+$").all()


def test_surveys(built):
    s = built["t"]["surveys"]
    alpha_wae = s[(s.lake_key == "mn:99010300") & (s.species == "WAE") & (s.gear_family == "gill")]
    assert sorted(alpha_wae["survey_year"]) == [1988, 1996, 2005, 2014, 2022]
    r = alpha_wae.iloc[-1]
    assert r["effort"] == r["gear_count"] and r["effort_source"] == "gear_count"
    assert abs(r["total_catch"] / r["effort"] - r["cpue"]) < 0.01
    assert r["lengths"] and all(set(x) == {"inch", "count"} for x in r["lengths"])
    # Echo's east basin uses the whole lake's survey, keyed to the whole lake (no duplicated rows).
    assert "mn:99051501" not in set(s.lake_key) and "mn:99051500" in set(s.lake_key)
    # Foxtrot published CPUE only.
    fox = s[s.lake_key == "mn:99061800"]
    assert fox["effort"].isna().all() and fox["total_catch"].isna().all() and fox["cpue"].notna().all()
    # Delta: an electrofishing-only special assessment; effort = hours (catch / CPUE), including zero-catch rows.
    el = s[(s.lake_key == "mn:99041200") & (s.gear_family == "electro")]
    assert len(el) == 3 and (el["effort_source"] == "catch/cpue").all() and el["effort"].nunique() == 1
    assert el["survey_type"].iloc[0] == "Special Assessment · Bass Electrofishing"
    # Lima's undated survey is dropped (and logged), the dated one kept.
    assert set(s[s.lake_key == "mn:99123600"]["survey_year"]) == {2015}
    # Golf (unparseable) and Hotel (no survey) have no rows.
    assert not set(s.lake_key) & {"mn:99072100", "mn:99082400"}


def test_sd_surveys(built):
    s = built["t"]["surveys"]
    sd = s[s.state == "SD"]
    amber = sd[sd.lake_key == "sd:fixture-lake-amber"]
    assert sorted(amber["survey_id"].unique()) == ["900101", "900102", "900103"]  # 3 newest surveys; creel/stocking skipped
    assert set(amber.loc[amber.survey_id == "900103", "survey_date"]) == {pd.Timestamp(date(2022, 6, 14))}
    assert amber.loc[amber.survey_id == "900101", "survey_date"].isna().all()
    assert (amber["source_url"].str.startswith("https://apps.sd.gov/GF56FisheriesReports/ExportPDF.ashx?ReportID=")).all()
    bass = sd[sd.lake_key == "sd:fixture-lake-basswood"]
    assert set(bass["parse_source"]) == {"gfp-summary"} and sorted(zip(bass.species, bass.cpue)) == [("BLG", 61.5), ("NOP", 4.2), ("WAE", 1.8)]
    assert set(sd[sd.lake_key == "sd:fixture-lake-heron"]["survey_year"]) == {2008}  # year from the report list
    assert set(sd[sd.lake_key == "sd:fixture-lake-cottonwood"]["survey_id"]) == {"900107"}  # newest PDF broken
    assert "sd:fixture-flats-reservoir" in set(sd.lake_key)  # found under the bare name "Fixture Flats"
    fox = sd[sd.lake_key == "sd:fixture-lake-fox"]
    assert set(fox.loc[fox.gear_family == "electro", "species"]) == {"SMB", "LMB"}
    assert sd["effort"].isna().all() and sd["normal_low"].isna().all()
    assert set(sd.loc[sd.gear == "Frame nets", "gear_family"]) == {"trap"}


def test_launches_stocking_regs(built):
    t = built["t"]
    la = t["launches"]
    assert set(la["ramp_class"]) == {"concrete", "gravel", "carry-in", "unknown"}
    assert "mn:99051501" in set(la.lake_key)  # the east basin's own access
    amber = la[la.lake_key == "sd:fixture-lake-amber"]
    assert sorted(amber["name"]) == ["Fixture Amber North Ramp", "Fixture Amber South Access"]  # OSM duplicate dropped
    assert set(la.loc[la.lake_key == "sd:fixture-lake-elm", "source"]) == {"OpenStreetMap (community map data)"}
    assert la.loc[la.name == "Fixture Lake Fox boat ramp", "ramp"].item() == "access: private"
    st = t["stocking"]
    assert set(st.lake_key) == {"mn:99010300", "mn:99030900", "mn:99051500", "mn:99103000", "mn:99113300", "mn:99144200"}
    assert set(st.loc[st.lake_key == "mn:99030900", "species"]) == {"WAE"}  # "Walleye" -> WAE
    regs = t["regs"]
    assert sorted(regs) == ["mn:99010300", "mn:99103000", "mn:99113300"]
    assert regs["mn:99103000"][0]["species"] == "MUE" and regs["mn:99103000"][1]["species"] is None
    assert all(r["text"].startswith("FIXTURE TEXT") and r["fetchedAt"] == "2026-10-01T00:00:00Z" for v in regs.values() for r in v)


def test_gaps(built):
    g = built["t"]["gaps"]
    b = g["bySource"]
    assert b["mn-lakefinder"]["survey-unparseable"]["examples"] == ["99-0721-00"]
    assert b["mn-lakefinder"]["sub-basin-uses-whole-lake"]["count"] == 1
    assert b["mn-lakefinder"]["survey-without-date"]["count"] == 1
    assert b["sd-gfp-reports"]["pdf-unreadable"]["count"] == 1
    assert b["sd-gfp-reports"]["no-survey-reports"]["examples"] == ["Fixture Lake Elm"]
    assert b["sd-gfp-reports"]["species-without-dnr-code"]["examples"] == ["Orangespotted Sunfish"]
    assert b["osm-overpass"]["duplicate-name-kept-largest"]["count"] == 1
    assert b["sd-gfp-gis"]["launch-not-matched-to-lake"]["count"] == 1
    assert "SD: 1 survey PDFs could not be read" in g["summary"]
    assert any("verify" in v.lower() or "loosely" in v for v in g["verify"])
    srcs = built["t"]["sources"]
    assert any("ODbL" in s["terms"] for s in srcs) and all(s["fetchedAt"] == "2026-10-01T00:00:00Z" for s in srcs)


def test_offline_limit_and_state(built, tmp_path, capsys):
    # tidy reads the cache only; an empty cache is an error, not empty tables.
    assert main(["tidy", "--cache", str(tmp_path / "empty"), "--out", str(tmp_path / "o"), "--bbox=-94.6,46.9,-93.4,47.6", "--state", "MN"]) == 3
    # fetch --offline reports misses without touching the network.
    assert main(["fetch", "--offline", "--cache", str(tmp_path / "empty"), "--bbox=-94.6,46.9,-93.4,47.6", "--state", "MN"]) == 0
    assert "not in cache" in capsys.readouterr().out
    # --limit and --state on the warm cache.
    out = tmp_path / "lim"
    assert main(["tidy", "--fixtures", str(RAW), "--cache", str(built["cache"]), "--out", str(out), "--state", "SD", "--limit", "3"]) == 0
    t = schema.read_tidy(out)
    assert list(t["lakes"]["lake_key"]) == ["sd:fixture-flats-reservoir", "sd:fixture-lake-amber", "sd:fixture-lake-basswood"]
    assert set(t["surveys"]["state"]) == {"SD"}
    assert schema.validate_tidy(t) == []


def test_mn_limit_stops_enumeration_early(tmp_path):
    out = tmp_path / "mn"
    assert main(["tidy", "--fixtures", str(RAW), "--out", str(out), "--state", "MN", "--limit", "4"]) == 0
    lakes = schema.read_tidy(out)["lakes"]
    assert len(lakes[lakes.parent_key.isna()]) <= 5 and len(lakes) >= 4


def test_grid_and_tiles():
    pts = grid_points((-94.6, 46.9, -93.4, 47.6), 28.0)
    assert len(pts) == 12 and pts[0] == (47.01667, -94.45)
    assert radius_m(28.0) == pytest.approx(20799, abs=1)
    assert tiles((-97.6, 44.0, -96.8, 44.6), 1.0) == [(-97.6, 44.0, -97.0, 44.6), (-97.0, 44.0, -96.8, 44.6)]
    # Whole MN at the default spacing: about 530 polite requests (~9 minutes at 1/s).
    assert 450 < len(grid_points((-97.3, 43.4, -89.4, 49.4), 28.0)) < 600
