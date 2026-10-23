"""DNR species codes and name rules, ported from the app.

Mirrors ``SPECIES``, ``NAME_ALIASES``, ``codeForName`` and ``isGameFish`` in
``src/features/fishing/lakeSurvey.ts`` and ``SD_SPECIES`` in
``src/features/fishing/sdParse.ts``. Keep them in step: a change there is a
change here (``tests/test_data_species.py`` pins the cases).
"""

from __future__ import annotations

# DNR fisheries species codes -> common names. Unknown codes are kept as-is.
SPECIES: dict[str, str] = {
    "WAE": "Walleye",
    "SAR": "Sauger",
    "NOP": "Northern pike",
    "MUE": "Muskellunge",
    "TME": "Tiger muskie",
    "YEP": "Yellow perch",
    "BLC": "Black crappie",
    "WHC": "White crappie",
    "BLG": "Bluegill",
    "PMK": "Pumpkinseed",
    "GSF": "Green sunfish",
    "HSF": "Hybrid sunfish",
    "RKB": "Rock bass",
    "LMB": "Largemouth bass",
    "SMB": "Smallmouth bass",
    "WHB": "White bass",
    "TLC": "Cisco (tullibee)",
    "CIS": "Cisco (tullibee)",
    "LKW": "Lake whitefish",
    "LAT": "Lake trout",
    "RBT": "Rainbow trout",
    "BNT": "Brown trout",
    "BKT": "Brook trout",
    "SPT": "Splake",
    "BUB": "Burbot (eelpout)",
    "BLB": "Black bullhead",
    "BRB": "Brown bullhead",
    "YEB": "Yellow bullhead",
    "CCF": "Channel catfish",
    "FCF": "Flathead catfish",
    "WTS": "White sucker",
    "SHR": "Shorthead redhorse",
    "GRH": "Golden redhorse",
    "SLR": "Silver redhorse",
    "CAP": "Common carp",
    "BIB": "Bigmouth buffalo",
    "FRD": "Freshwater drum",
    "BOF": "Bowfin (dogfish)",
    "LNG": "Longnose gar",
    "SNG": "Shortnose gar",
    "GOS": "Golden shiner",
    "GZS": "Gizzard shad",
    "GOE": "Goldeye",
    "MOE": "Mooneye",
    "LKS": "Lake sturgeon",
    "HFC": "Hybrid (walleye × sauger)",
}

# Species people usually fish for (accent colour in the app).
GAME: frozenset[str] = frozenset(
    "WAE SAR NOP MUE TME YEP BLC WHC BLG PMK LMB SMB RKB LAT RBT BNT BKT SPT LKW TLC CIS CCF FCF HSF WHB".split()
)

NAME_ALIASES: dict[str, str] = {
    "tiger muskellunge": "TME",
    "saugeye": "HFC",
    "cisco": "TLC",
    "tullibee": "TLC",
    "eelpout": "BUB",
    "dogfish": "BOF",
    "carp": "CAP",
}

# Species names the SD GFP report parser looks for (order matters: "Tiger Muskellunge" before "Muskellunge").
SD_SPECIES: list[str] = [
    "Tiger Muskellunge",
    "Muskellunge",
    "Walleye",
    "Sauger",
    "Saugeye",
    "Northern Pike",
    "Yellow Perch",
    "Black Crappie",
    "White Crappie",
    "Bluegill",
    "Pumpkinseed",
    "Green Sunfish",
    "Orangespotted Sunfish",
    "Hybrid Sunfish",
    "Rock Bass",
    "Largemouth Bass",
    "Smallmouth Bass",
    "White Bass",
    "Channel Catfish",
    "Flathead Catfish",
    "Black Bullhead",
    "Yellow Bullhead",
    "Brown Bullhead",
    "Common Carp",
    "White Sucker",
    "Bigmouth Buffalo",
    "Smallmouth Buffalo",
    "Freshwater Drum",
    "Shorthead Redhorse",
    "Rainbow Trout",
    "Brown Trout",
    "Brook Trout",
    "Lake Trout",
    "Cisco",
    "Lake Whitefish",
    "Rainbow Smelt",
    "Gizzard Shad",
    "Spottail Shiner",
    "Golden Shiner",
    "Goldeye",
    "Shortnose Gar",
    "Longnose Gar",
    "Bowfin",
    "Burbot",
]


def code_for_name(name: str) -> str:
    """DNR species code for a common name ("Yellow Perch" -> "YEP"); '' if unknown. Same rules as ``codeForName``."""
    n = name.strip().lower()
    if n in NAME_ALIASES:
        return NAME_ALIASES[n]
    for code, label in SPECIES.items():
        lab = label.lower()
        if lab == n or lab.startswith(f"{n} ("):
            return code
    return ""


def is_game_fish(code: str) -> bool:
    return code.upper() in GAME


def species_name(code: str) -> str:
    return SPECIES.get(code.upper(), code)
