"""LakeFinder JSON: parity with src/features/fishing/lakeSurvey.test.ts, plus the pipeline's extra (verify) fields."""

import json
from pathlib import Path

import pytest

from lakerecs.parse_lakefinder import (
    NoSurvey,
    discover_detail_types,
    find_point,
    gear_family,
    gear_family_label,
    get,
    lake_features,
    latest_with_catch,
    num,
    parse_json_loose,
    parse_lake_survey,
    parse_nearby_lakes,
    parse_range,
    parse_regs,
    parse_stocking,
    script_srcs,
    survey_lengths,
)

TS_TEST = Path(__file__).resolve().parents[2] / "src/features/fishing/lakeSurvey.test.ts"

# Same object as `sample` in lakeSurvey.test.ts.
SAMPLE = {
    "result": {
        "lakeName": "Bear Head",
        "surveys": [
            {
                "surveyDate": "2015-07-20",
                "surveyType": "Standard Survey",
                "fishCatchSummaries": [{"species": "WAE", "gear": "Standard gill nets", "gearCount": 6, "totalCatch": 20, "CPUE": "3.33", "quartileCount": "2.0-8.0", "averageWeight": "1.10"}],
            },
            {
                "surveyDate": "2021-07-12",
                "surveyType": "Population Assessment",
                "fishCatchSummaries": [
                    {"species": "WAE", "gear": "Standard gill nets", "gearCount": 6, "totalCatch": 54, "CPUE": "9.00", "quartileCount": "3.3-10.5", "averageWeight": "1.35", "quartileWeight": "0.9-1.6"},
                    {"species": "NOP", "gear": "Standard gill nets", "gearCount": 6, "totalCatch": 12, "CPUE": "2.00", "quartileCount": "2.5-7.2", "averageWeight": "2.9"},
                    {"species": "YEP", "gear": "Standard gill nets", "gearCount": 6, "totalCatch": 96, "CPUE": "16.00", "quartileCount": "6.0-30.0", "averageWeight": "0.12"},
                    {"species": "YEP", "gear": "Shallow gill nets", "gearCount": 2, "totalCatch": 30, "CPUE": "15.00", "quartileCount": "N/A", "averageWeight": "0.1"},
                    {"species": "BLG", "gear": "Standard trap nets", "gearCount": 9, "totalCatch": 270, "CPUE": "30.00", "quartileCount": "10.0-60.0", "averageWeight": "0.20"},
                    {"species": "SMB", "gear": "Standard trap nets", "gearCount": 9, "totalCatch": 3, "CPUE": "0.33", "quartileCount": "", "averageWeight": ""},
                ],
            },
            {"surveyDate": "2023-06-01", "surveyType": "Special Assessment", "fishCatchSummaries": []},
        ],
    }
}


def _strip(c):
    return {k: v for k, v in c.items() if not k.startswith("_")}


def test_reads_surveys_newest_first_with_catch_rows():
    s = parse_lake_survey(SAMPLE, "69025400")
    assert s["lakeName"] == "Bear Head"
    assert [x["date"] for x in s["surveys"]] == ["2023-06-01", "2021-07-12", "2015-07-20"]
    latest = latest_with_catch(s)
    assert latest["date"] == "2021-07-12"
    assert latest["catches"][0] == {
        "species": "WAE",
        "gear": "Standard gill nets",
        "gearCount": 6,
        "totalCatch": 54,
        "cpue": 9,
        "normalLow": 3.3,
        "normalHigh": 10.5,
        "avgWeightLb": 1.35,
        "normalWeightLow": 0.9,
        "normalWeightHigh": 1.6,
    }
    yep_shallow = latest["catches"][3]
    assert (yep_shallow["normalLow"], yep_shallow["normalHigh"]) == (None, None)  # "N/A"
    smb = latest["catches"][5]
    assert smb["avgWeightLb"] is None and smb["normalLow"] is None


def test_catch_shares_numbers_match_the_app():
    latest = latest_with_catch(parse_lake_survey(SAMPLE, "69025400"))
    totals = {}
    for c in latest["catches"]:
        totals[c["species"]] = totals.get(c["species"], 0) + c["totalCatch"]
    assert max(totals, key=totals.get) == "BLG" and totals["BLG"] == 270
    assert totals["YEP"] == 126


def test_gear_families_match_gearFamily():
    assert [gear_family_label(g) for g in ["Standard gill nets", "Shallow gill nets", "Standard trap nets", "Boat electrofishing", "Boatshock", "Beach seine", "Fyke", ""]] == [
        "Gill nets",
        "Gill nets",
        "Trap nets",
        "Electrofishing",
        "Electrofishing",
        "Seines",
        "Fyke",
        "Other",
    ]
    assert [gear_family(g) for g in ["Standard gill nets", "Standard trap nets", "Standard electrofishing", "Seine", "Fyke", "Frame nets", "Gill nets", "Electrofishing"]] == [
        "gill",
        "trap",
        "electro",
        "seine",
        "other",
        "trap",  # SD GFP frame nets: trap family, as sdParse's gearOf groups (frame|trap) nets
        "gill",
        "electro",
    ]


def test_no_survey_and_jsonp():
    with pytest.raises(NoSurvey, match="No lake survey found"):
        parse_lake_survey({"status": "ERROR", "message": "No lake survey found"}, "12345678")
    with pytest.raises(NoSurvey):
        parse_lake_survey(None, "12345678")
    assert parse_json_loose('cb({"a":1})') == {"a": 1}
    with pytest.raises(ValueError):
        parse_json_loose("<html>500</html>")


def test_nearby_lakes_like_the_app():
    data = {"status": "OK", "results": [{"name": "Bear Head", "id": "69025400", "county": "St. Louis", "point": {"epsg:4326": [-92.0, 47.8]}}, {"name": "Eagles Nest #4", "id": "69028500", "county": "St. Louis"}]}
    got = [{k: v for k, v in x.items() if k != "_raw"} for x in parse_nearby_lakes(data)]
    assert got == [
        {"dow": "69025400", "name": "Bear Head", "county": "St. Louis", "lat": 47.8, "lng": -92.0},
        {"dow": "69028500", "name": "Eagles Nest #4", "county": "St. Louis", "lat": None, "lng": None},
    ]
    assert find_point({"lat": 47.1, "lon": -93.2}) == (47.1, -93.2)
    assert find_point({"geometry": {"coordinates": [47.1, -93.2]}}) == (47.1, -93.2)
    assert find_point({"lat": 10, "lon": 10}) is None


def test_loose_helpers():
    assert get({"Fish_Catch-Summaries": 1}, "fishCatchSummaries") == 1
    assert parse_range("3.3–10.5") == (3.3, 10.5)
    assert parse_range("N/A") == (None, None)
    assert num("1,234") == 1234
    assert num(" 9.00 ") == 9
    assert num("") is None and num(None) is None
    assert num("N/A") is None  # TS gives 0 here (Number('')); the pipeline won't invent a zero
    assert num(True) is None


@pytest.mark.skipif(not TS_TEST.exists(), reason="app source not present")
def test_ts_fixture_has_not_drifted():
    """If lakeSurvey.test.ts changes its sample, update SAMPLE above to match."""
    ts = TS_TEST.read_text(encoding="utf-8")
    for needle in ["totalCatch: 54, CPUE: '9.00', quartileCount: '3.3-10.5', averageWeight: '1.35', quartileWeight: '0.9-1.6'", "normalLow: 3.3", "normalHigh: 10.5", "toBe(126)", "quartileCount: 'N/A'"]:
        assert needle in ts


# ------------------------------------------------------------------ pipeline extras (verify keys)


def test_lake_features_loose():
    f = lake_features({"lakeName": "X", "countyName": "Fixture County", "areaAcres": "1,180.5", "maxDepth": 41, "averageWaterClarity": "8.5 ft", "fisheriesRegion": "2"})
    assert f == {"area_acres": 1180.5, "max_depth_ft": 41, "clarity_ft": 8.5, "county": "Fixture County", "region": "2", "lat": None, "lng": None}
    assert lake_features({"area": 0})["area_acres"] is None  # zero/negative = unknown


@pytest.mark.parametrize(
    "raw,expected",
    [
        ({"lengths": {"WAE": {"species": "WAE", "fishCount": [[12, 3], [10, 1]]}}}, {("WAE", ""): [(10, 1), (12, 3)]}),
        ({"lengthDistributions": [{"species": "Northern Pike", "gear": "Standard gill nets", "counts": [{"inch": 20, "count": 2}]}]}, {("NOP", "Standard gill nets"): [(20, 2)]}),
        ({"fishLengths": [{"species": "YEP", "length": 7, "count": 4}, {"species": "YEP", "length": 6, "count": 1}]}, {("YEP", ""): [(6, 1), (7, 4)]}),
        ({"lengths": {"BLG": {"3": 1, "4": 5}}}, {("BLG", ""): [(3, 1), (4, 5)]}),
        ({"lengths": {"WAE": {"fishCount": [["x", 1]]}}}, {}),
        ({"surveyDate": "2020-01-01"}, {}),
    ],
)
def test_lengths_shapes(raw, expected):
    assert survey_lengths(raw) == expected


def test_stocking_and_regs_loose():
    rows, problems = parse_stocking({"result": {"stocking": [{"year": 2019, "species": "WAE", "size": "fry", "number": "1,000"}, {"year": "2020", "species": "Walleye", "size": "fingerling"}, {"year": 2021, "species": "Zebra Fish", "number": 3}]}})
    assert rows == [{"year": 2019, "species": "WAE", "count": 1000, "size": "fry"}, {"year": 2020, "species": "WAE", "count": None, "size": "fingerling"}]
    assert problems == ["unknown species 'Zebra Fish'"]
    regs = parse_regs({"result": {"specialRegulations": [{"species": "Muskellunge", "regulation": "<b>FIXTURE</b> text &amp; more   words"}, {"species": None, "regulation": "General fixture rule text."}, {"species": "WAE", "regulation": "short"}, {"url": "https://example.invalid/a-long-url-not-a-rule"}]}})
    assert regs == [{"species": "MUE", "text": "FIXTURE text & more words"}, {"species": None, "text": "General fixture rule text."}]


def test_detail_type_discovery():
    page = '<script src="/lakefind/js/a.js"></script><script src="https://other.example/b.js"></script>'
    assert script_srcs(page) == ["/lakefind/js/a.js", "https://other.example/b.js"]
    js = "get('detail.cgi?type=lake_survey&id='+id); $.get(url + 'detail.cgi?callback=&type=fish_things&id=' + id); request({url: 'detail.cgi', type: 'reg_things'})"
    assert discover_detail_types([js]) == ["lake_survey", "fish_things", "reg_things"]


def test_fixture_survey_json_is_valid_for_the_parser():
    raw = Path(__file__).resolve().parents[1] / "fixtures/raw/mn/survey"
    if not raw.exists():
        pytest.skip("fixtures not generated")
    files = sorted(raw.glob("*.json"))
    assert len(files) >= 20
    parsed = 0
    for f in files:
        try:
            s = parse_lake_survey(json.loads(f.read_text()), f.stem)
        except NoSurvey:
            continue
        assert s["lakeName"].startswith("Fixture Lake")
        parsed += 1
    assert parsed >= 18
