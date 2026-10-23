"""Species codes and names: same rules (and same tables) as the app."""

import re
from pathlib import Path

import pytest

from lakerecs.species import GAME, SD_SPECIES, SPECIES, code_for_name, is_game_fish, species_name

REPO = Path(__file__).resolve().parents[2]
LAKE_SURVEY_TS = REPO / "src/features/fishing/lakeSurvey.ts"
SD_PARSE_TS = REPO / "src/features/fishing/sdParse.ts"


@pytest.mark.parametrize(
    "name,code",
    [
        ("Yellow Perch", "YEP"),
        ("  walleye ", "WAE"),
        ("Northern Pike", "NOP"),
        ("Cisco", "TLC"),
        ("Tiger Muskellunge", "TME"),
        ("Saugeye", "HFC"),
        ("Burbot", "BUB"),  # "Burbot (eelpout)" starts with "burbot ("
        ("Bowfin", "BOF"),
        ("Common Carp", "CAP"),
        ("Black Crappie", "BLC"),
        ("Orangespotted Sunfish", ""),
        ("Smallmouth Buffalo", ""),
        ("Rainbow Smelt", ""),
    ],
)
def test_code_for_name(name, code):
    assert code_for_name(name) == code


def test_every_sd_species_is_known_or_explicitly_unmapped():
    unmapped = sorted(n for n in SD_SPECIES if not code_for_name(n))
    # These have no code in the app's table: their rows go to gaps.json, never to invented codes.
    assert unmapped == ["Orangespotted Sunfish", "Rainbow Smelt", "Smallmouth Buffalo", "Spottail Shiner"]


def test_names_and_game_fish():
    assert species_name("wae") == "Walleye"
    assert species_name("ZZZ") == "ZZZ"
    assert is_game_fish("blg") and not is_game_fish("WTS")
    assert GAME <= set(SPECIES)


@pytest.mark.skipif(not LAKE_SURVEY_TS.exists(), reason="app source not present")
def test_species_table_matches_the_app():
    ts = LAKE_SURVEY_TS.read_text(encoding="utf-8")
    block = ts[ts.index("export const SPECIES") : ts.index("};", ts.index("export const SPECIES"))]
    pairs = dict(re.findall(r"^\s+([A-Z]{3}): '([^']*)',", block, re.M))
    assert pairs == SPECIES
    aliases = ts[ts.index("const NAME_ALIASES") : ts.index("};", ts.index("const NAME_ALIASES"))]
    assert dict(re.findall(r"^\s+'?([a-z ]+?)'?: '([A-Z]{3})',", aliases, re.M)) == {
        "tiger muskellunge": "TME",
        "saugeye": "HFC",
        "cisco": "TLC",
        "tullibee": "TLC",
        "eelpout": "BUB",
        "dogfish": "BOF",
        "carp": "CAP",
    }
    game = re.search(r"const GAME = new Set\(\[([^\]]*)\]\)", ts).group(1)
    assert set(re.findall(r"'([A-Z]{3})'", game)) == set(GAME)


@pytest.mark.skipif(not SD_PARSE_TS.exists(), reason="app source not present")
def test_sd_species_list_matches_the_app():
    ts = SD_PARSE_TS.read_text(encoding="utf-8")
    block = ts[ts.index("export const SD_SPECIES") : ts.index("];", ts.index("export const SD_SPECIES"))]
    assert re.findall(r"'([^']+)'", block) == SD_SPECIES
