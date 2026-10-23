"""schema.py: the tidy tables' contract (Agent B imports validate_frame / read_tidy)."""

from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from lakerecs import schema

FIXTURE_TIDY = Path(__file__).resolve().parents[1] / "fixtures/tidy"


def survey_row(**kw):
    r = {
        "lake_key": "mn:99010300",
        "state": "MN",
        "species": "WAE",
        "survey_id": "2022-07-01|Standard Survey",
        "survey_date": date(2022, 7, 1),
        "survey_type": "Standard Survey",
        "gear": "Standard gill nets",
        "gear_family": "gill",
        "effort": 6.0,
        "total_catch": 54,
        "cpue": 9.0,
        "normal_low": 3.3,
        "normal_high": 10.5,
        "avg_weight_lb": 1.35,
        "normal_weight_low": 0.9,
        "normal_weight_high": 1.6,
        "lengths": [{"inch": 12, "count": 3}],
        "source_url": "https://www.dnr.state.mn.us/lakefind/lake.html?id=99010300",
        "parse_source": "lakefinder-json",
    }
    r.update(kw)
    return r


def frame(*rows):
    return schema.frame_from_rows(rows, "surveys")


def test_plan_columns_are_all_there():
    plan = "lake_key state species survey_id survey_date survey_type gear gear_family effort total_catch cpue normal_low normal_high avg_weight_lb normal_weight_low normal_weight_high lengths source_url parse_source".split()
    assert schema.column_names("surveys", include_optional=False) == plan
    assert schema.column_names("lakes", include_optional=False) == "lake_key state name county lat lng area_acres max_depth_ft clarity_ft region source_url".split()
    assert schema.column_names("launches") == "lake_key name lat lng ramp ramp_class source".split()
    assert schema.column_names("stocking") == "lake_key year species count size source_url".split()


def test_empty_frames_are_valid_and_typed():
    for t in schema.TABLES:
        df = schema.empty_frame(t)
        assert schema.validate_frame(df, t) == []
        assert list(df.columns) == schema.column_names(t)
    df = schema.empty_frame("surveys")
    assert str(df["survey_date"].dtype) == "datetime64[ns]" and str(df["total_catch"].dtype) == "Int64" and str(df["cpue"].dtype) == "float64"


def test_a_plan_only_frame_validates():
    """B's synthetic generator can build only the plan's columns: optional additions may be absent."""
    df = pd.DataFrame([survey_row()])
    assert schema.validate_frame(df, "surveys") == []
    co = schema.coerce_frame(df, "surveys")
    assert "survey_year" in co.columns and co["survey_year"].isna().all()


@pytest.mark.parametrize(
    "change,needle",
    [
        ({"state": "WI"}, "state: values outside"),
        ({"gear_family": "fyke"}, "gear_family: values outside"),
        ({"parse_source": "scraped"}, "parse_source"),
        ({"lake_key": "mn:123"}, "lake_key: values not matching"),
        ({"lake_key": "sd:fixture-lake", "state": "MN"}, "prefix doesn't match"),
        ({"species": "Walleye"}, "species: values not matching"),
        ({"cpue": -1.0}, "cpue: values < 0"),
        ({"effort": 0.0}, "effort: values <= 0"),
        ({"normal_low": 11.0}, "normal_low > normal_high"),
        ({"source_url": None}, "source_url: nulls not allowed"),
        ({"lengths": [{"inch": 12}]}, "bad length lists"),
        ({"cpue": float("inf")}, "infinite"),
    ],
)
def test_validation_catches(change, needle):
    df = pd.DataFrame([survey_row(**change)])
    errs = schema.validate_frame(df, "surveys")
    assert any(needle in e for e in errs), errs


def test_structure_problems():
    df = pd.DataFrame([survey_row(), survey_row()])
    assert any("duplicate primary key" in e for e in schema.validate_frame(df, "surveys"))
    assert any("missing column cpue" in e for e in schema.validate_frame(df.drop(columns=["cpue"]), "surveys"))
    assert any("unexpected columns" in e for e in schema.validate_frame(df.assign(extra=1), "surveys"))
    assert schema.validate_frame(df.assign(extra=1).iloc[:1], "surveys", allow_extra=True) == []
    assert any("dtype" in e for e in schema.validate_frame(df.assign(cpue="9"), "surveys"))
    assert schema.validate_frame(df, "nope") == ["unknown table 'nope'"]
    with pytest.raises(ValueError):
        schema.check_frame(df, "surveys")
    lakes = pd.DataFrame([{"lake_key": "mn:99010300", "state": "MN", "name": "Fixture", "county": None, "lat": 47.0, "lng": None, "area_acres": None, "max_depth_ft": None, "clarity_ft": None, "region": "MN:cell:47_-94", "source_url": "https://x"}])
    assert any("half set" in e for e in schema.validate_frame(lakes, "lakes"))
    assert any("outside MN/SD" in e for e in schema.validate_frame(lakes.assign(lng=10.0), "lakes"))


def test_parquet_round_trip(tmp_path):
    df = frame(survey_row(), survey_row(species="NOP", lengths=None, survey_date=None, total_catch=None, effort=np.nan))
    schema.write_parquet(df, tmp_path / "s.parquet", "surveys")
    back = schema.read_parquet(tmp_path / "s.parquet", "surveys")
    pd.testing.assert_frame_equal(back, df)
    assert back.loc[0, "lengths"] == [{"inch": 12, "count": 3}]
    assert back.loc[1, "lengths"] is None and pd.isna(back.loc[1, "survey_date"])
    import pyarrow.parquet as pq

    assert str(pq.read_schema(tmp_path / "s.parquet").field("survey_date").type) == "date32[day]"


def test_regs_gaps_sources_validators():
    ok = {"mn:99010300": [{"species": "WAE", "text": "Fixture rule text.", "url": "https://x", "fetchedAt": "2026-10-01T00:00:00Z"}], "sd:fixture-lake": [{"species": None, "text": "Fixture.", "url": "https://x", "fetchedAt": "2026-10-01T00:00:00Z"}]}
    assert schema.validate_regs(ok) == []
    assert schema.validate_regs({"x": []}) == ["regs: bad lake key 'x'"]
    assert schema.validate_regs({"mn:99010300": [{"species": "WAE", "text": " ", "url": "x", "fetchedAt": "yesterday"}]}) == ["regs[mn:99010300][0]: empty text", "regs[mn:99010300][0]: bad url", "regs[mn:99010300][0]: fetchedAt must be ISO time"]
    assert schema.validate_gaps({"bySource": {"s": {"k": {"count": 1, "examples": []}}}, "summary": [], "verify": []}) == []
    assert schema.validate_gaps({"bySource": {}}) != []
    assert schema.validate_sources([{"name": "a", "url": "b", "terms": "c", "fetchedAt": None}]) == []


def test_committed_fixture_tidy_tables_are_valid():
    t = schema.read_tidy(FIXTURE_TIDY)
    assert set(t) == set(schema.FILES)
    assert schema.validate_tidy(t) == []
    s = t["surveys"]
    assert set(s["state"]) == {"MN", "SD"}
    assert set(s["parse_source"]) == {"lakefinder-json", "gfp-table", "gfp-summary"}
    assert set(s["gear_family"]) == {"gill", "trap", "electro"}
    assert t["lakes"]["name"].str.startswith("Fixture").all()  # synthetic lakes only, never real names
