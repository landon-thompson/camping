"""SD GFP reports: parity with src/features/fishing/sdParse.test.ts and api/src/lib/sdFishReports.ts."""

from datetime import date

import pytest

from lakerecs.parse_gfp import (
    ReportLink,
    canonical,
    gear_of,
    parse_report_links,
    parse_survey,
    pdf_lines,
    pick_survey,
    sd_lake_key,
    sd_slug,
    survey_links,
    survey_type,
    water_name_variants,
)
from lakerecs.sources import gfp_list_url, gfp_pdf_url
from lakerecs.testpdf import make_pdf

ENEMY_SWIM = [
    (72, 740, "Enemy Swim Lake Survey Summary"),
    (72, 720, "2021"),
    (72, 690, "Yellow perch were numerous, accounting for 65% of the sample. Although walleye numbers"),
    (72, 676, "were higher in 2021 than in 2020, relative abundance remained low (3.4 per gill net)."),
    (72, 662, "Bluegill relative abundance was high (46.0/frame net) and fish ranged from 3.1 to 9.8 inches."),
    (72, 630, "Table 1. Mean CPUE of fish captured in gill nets and frame nets, Enemy Swim Lake, 2021."),
    (72, 610, "Gill nets"),
    (72, 596, "Species"),
    (250, 596, "CPUE"),
    (320, 596, "PSD"),
    (72, 582, "Walleye"),
    (250, 582, "3.4"),
    (320, 582, "52"),
    (72, 568, "Yellow Perch"),
    (250, 568, "28.6"),
    (320, 568, "31"),
    (72, 548, "Frame nets"),
    (72, 534, "Bluegill"),
    (250, 534, "46.0"),
    (72, 520, "Black Crappie"),
    (250, 520, "5.2"),
]


def catches(s):
    return [(c.species, c.gear, c.cpue, c.source) for c in s.catches]


def test_reads_lines_and_columns_from_a_real_pdf_then_summary_and_catch():
    pages = pdf_lines(make_pdf(ENEMY_SWIM))
    assert "Walleye | 3.4 | 52" in pages[0]
    s = parse_survey(pages)
    assert s.year == 2021
    assert s.title == "Enemy Swim Lake Survey Summary"
    assert s.summary[0].startswith("Yellow perch were numerous")
    assert catches(s) == [
        ("Bluegill", "Frame nets", 46, "table"),
        ("Black Crappie", "Frame nets", 5.2, "table"),
        ("Yellow Perch", "Gill nets", 28.6, "table"),
        ("Walleye", "Gill nets", 3.4, "table"),
    ]
    assert s.date is None


def test_falls_back_to_numbers_quoted_in_the_summary():
    s = parse_survey([["Pickerel Survey Summary 2019", "Walleye numbers were low (1.8/gill net) and northern pike were common (4.2 per gill net).", "Bluegill were abundant (61.5/frame net) in the sample taken."]])
    assert catches(s) == [
        ("Bluegill", "Frame nets", 61.5, "summary"),
        ("Northern Pike", "Gill nets", 4.2, "summary"),
        ("Walleye", "Gill nets", 1.8, "summary"),
    ]


def test_table_rules():
    s = parse_survey(
        [
            [
                "Fixture Survey Summary 2020",
                "Electrofishing",
                "Smallmouth Bass | 22.5 | 40",
                "Largemouth Bass | 3000",  # out of range: ignored
                "Walleye were seen in electrofishing samples near the inlet and along the dam face.",  # prose, not a heading
                "Bluegills | 12",
                "Trap nets",
                "Tiger Muskellunge | 0.4",
            ]
        ]
    )
    assert catches(s) == [
        ("Smallmouth Bass", "Electrofishing", 22.5, "table"),
        ("Bluegill", "Electrofishing", 12, "table"),
        ("Tiger Muskellunge", "Frame nets", 0.4, "table"),
    ]
    assert gear_of("Boat shocking") == "Electrofishing" and gear_of("nothing") is None
    assert canonical("northern   pike") == "Northern Pike"


def test_full_date_and_title_kinds():
    s = parse_survey([["Fixture Lake Statewide Fisheries Survey", "Sampled June 14, 2022 by crews"]])
    assert s.year == 2022 and s.date == date(2022, 6, 14)
    assert survey_type(s.title) == "Statewide Fisheries Survey"
    assert survey_type("Fixture Survey Summary") == "Survey Summary"
    assert survey_type("Something else") == "GFP report"
    assert parse_survey([["6/31/2020 nonsense date"]]).date is None
    assert parse_survey([]).title == "Lake survey"


def test_broken_pdf_raises():
    with pytest.raises(Exception):
        pdf_lines(b"%PDF-1.4\n% broken\n1 0 obj\n<< /Type /Catalog")


def test_multi_page_pdf():
    pages = pdf_lines(make_pdf([[(72, 700, "Page one Survey Summary 2018")], [(72, 700, "Walleye"), (250, 700, "4.4")]]))
    assert pages == [["Page one Survey Summary 2018"], ["Walleye | 4.4"]]


# ------------------------------------------------------------------ report lists


LIST_HTML = """
<table>
<tr><td>2019</td><td>Lake Survey</td><td><a href="ExportPDF.ashx?ReportID=1200">Fixture Lake Survey Summary 2019</a></td></tr>
<tr><td>2021</td><td>Creel</td><td><a href='/GF56FisheriesReports/ExportPDF.ashx?ReportID=1300&amp;x=1'>Angler Creel Survey</a></td></tr>
<tr><td>2022</td><td>Lake Survey</td><td><a class="r" href="ExportPDF.ashx?ReportID=1250">Fixture &amp; Co Survey</a></td></tr>
<tr><td>2023</td><td>Stocking</td><td><a href="ExportPDF.ashx?ReportID=1400">Stocking report</a></td></tr>
<tr><td>dup</td><td><a href="ExportPDF.ashx?ReportID=1200">again</a></td></tr>
</table>
"""


def test_report_links_and_pick():
    links = parse_report_links(LIST_HTML)
    assert [x.id for x in links] == ["1200", "1300", "1250", "1400"]
    assert links[2].text == "2022 Lake Survey Fixture & Co Survey"
    assert [x.id for x in survey_links(links)] == ["1250", "1200"]
    assert pick_survey(links).id == "1250"
    # No "survey" in any link text: newest non-creel/stocking/map report.
    assert pick_survey([ReportLink("5", "Report 2001"), ReportLink("9", "Lake map"), ReportLink("7", "Report 2010")]).id == "7"
    assert pick_survey([]) is None


def test_names_urls_and_slugs():
    assert water_name_variants("Enemy Swim Lake") == ["Enemy Swim Lake", "Enemy Swim"]
    assert water_name_variants("Lake  Poinsett") == ["Lake Poinsett", "Poinsett"]
    assert water_name_variants("Angostura Reservoir") == ["Angostura Reservoir", "Angostura"]
    assert water_name_variants("Oahe") == ["Oahe"]
    assert gfp_list_url("Enemy Swim Lake") == "https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Enemy+Swim+Lake"
    assert gfp_list_url("Fixture's (Lake)") == "https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Fixture's+(Lake)"
    assert gfp_pdf_url("123") == "https://apps.sd.gov/GF56FisheriesReports/ExportPDF.ashx?ReportID=123"
    assert sd_slug("Enemy Swim Lake") == "enemy-swim-lake"
    assert sd_slug("  Lake Kampeska!! ") == "lake-kampeska"
    assert sd_slug("Fixture's Pond #2") == "fixture-s-pond-2"
    assert sd_lake_key("Fixture Flats Reservoir") == "sd:fixture-flats-reservoir"
