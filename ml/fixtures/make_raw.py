"""Writes ml/fixtures/raw/: SYNTHETIC recorded-shape responses for a fake region.

Every lake here is invented ("Fixture Lake ...", DOW numbers 99xxxxxx, GFP
report ids 9001xx, OSM ids 9000000xx) and every number is drawn from a seeded
random generator. Shapes follow the app's parsers and tests:
LakeFinder JSON as in src/features/fishing/lakeSurvey.test.ts, GFP PDFs as in
sdParse.test.ts, ArcGIS/Overpass as in places/*.ts. Keys the app has never
seen live (lake features, lengths, stocking, regulations) are GUESSES, marked
verify in lakerecs/sources.py.

Run from ml/:  python fixtures/make_raw.py [out_dir]   (then: python -m lakerecs all --fixtures fixtures/raw --out fixtures/tidy)
"""

from __future__ import annotations

import json
import math
import random
import shutil
import sys
from pathlib import Path
from urllib.parse import urlencode

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

from lakerecs import sources as S  # noqa: E402
from lakerecs.fetch import grid_points, intersect, radius_m, tiles  # noqa: E402
from lakerecs.parse_arcgis import query_url  # noqa: E402
from lakerecs.parse_gfp import water_name_variants  # noqa: E402
from lakerecs.parse_osm import distance_km, overpass_query  # noqa: E402
from lakerecs.testpdf import make_pdf  # noqa: E402

OUT = ML / "fixtures" / "raw"
MN_BOX = (-94.6, 46.9, -93.4, 47.6)
SD_BOX = (-97.6, 44.0, -96.8, 44.6)
rng = random.Random(20261001)

entries: list[dict] = []


def put(url: str, rel: str, content: bytes | str, *, method: str = "GET", body: str | None = None, status: int = 200, ctype: str = "application/json") -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    data = content.encode("utf-8") if isinstance(content, str) else content
    if not p.exists():
        p.write_bytes(data)
    entries.append({"method": method, "url": url, "body": body, "status": status, "file": rel, "content_type": ctype})


def js(o) -> str:
    return json.dumps(o, indent=1, ensure_ascii=False)


# ====================================================================== MN

NAMES = "Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee".split()

TYPICAL = {  # synthetic "typical" catch per gear family
    "gill": {"WAE": 8, "NOP": 5, "YEP": 15, "TLC": 5, "WTS": 3, "LAT": 2, "BLB": 6, "BLC": 1.5, "RKB": 0.8, "MUE": 0.3, "SMB": 0.5},
    "trap": {"BLG": 20, "BLC": 4, "PMK": 3, "LMB": 0.5, "NOP": 1.2, "YEP": 2, "BLB": 10, "RKB": 2, "WAE": 0.6, "HSF": 1},
    "electro": {"LMB": 40, "SMB": 25, "BLG": 80, "PMK": 15},
}
WEIGHT = {"WAE": 1.3, "NOP": 2.4, "YEP": 0.12, "TLC": 0.5, "WTS": 1.8, "LAT": 3.0, "BLB": 0.4, "BLC": 0.35, "RKB": 0.3, "MUE": 9.0, "SMB": 1.4, "BLG": 0.2, "PMK": 0.15, "LMB": 1.1, "HSF": 0.25}
GEAR_TEXT = {"gill": "Standard gill nets", "trap": "Standard trap nets", "electro": "Standard electrofishing"}


def lake_point(i: int) -> tuple[float, float]:
    """Spread the 25 lakes over the MN fixture box on a jittered 5 × 5 layout."""
    r, c = divmod(i, 5)
    w, s, e, n = MN_BOX
    lat = s + (r + 0.5 + rng.uniform(-0.3, 0.3)) * (n - s) / 5
    lng = w + (c + 0.5 + rng.uniform(-0.3, 0.3)) * (e - w) / 5
    return round(lat, 5), round(lng, 5)


def rng_range(v: float) -> str:
    return f"{v * 0.45:.1f}-{v * 1.6:.1f}"


def catch_row(sp: str, fam: str, quality: float, year: int, nets: int, hours: float | None = None, *, ranges: bool = True, weights: bool = True) -> dict:
    mean = TYPICAL[fam][sp] * quality * math.exp(rng.gauss(0, 0.35))
    eff = hours if fam == "electro" else nets
    total = max(0, round(rng.gammavariate(4, mean * eff / 4)))
    cpue = total / eff
    w = WEIGHT[sp] * math.exp(rng.gauss(0, 0.2))
    row = {"species": sp, "gear": GEAR_TEXT[fam], "gearCount": nets, "totalCatch": total, "CPUE": f"{cpue:.2f}"}
    if ranges and fam != "electro":
        row["quartileCount"] = rng_range(TYPICAL[fam][sp])
    elif fam != "electro":
        row["quartileCount"] = "N/A"
    row["averageWeight"] = f"{w:.2f}" if weights and total else ""
    if weights and total and rng.random() < 0.6:
        row["quartileWeight"] = f"{WEIGHT[sp] * 0.7:.2f}-{WEIGHT[sp] * 1.3:.2f}"
    return row


def survey(date: str, typ: str, rows: list[dict], sub: str | None = None, lengths: dict | None = None) -> dict:
    s = {"surveyDate": date, "surveyType": typ}
    if sub:
        s["surveySubType"] = sub
    s["fishCatchSummaries"] = rows
    if lengths:
        s["lengths"] = lengths
    return s


def lengths_for(sp: str, n: int, mid: int) -> dict:
    counts = {}
    for _ in range(n):
        inch = max(3, round(rng.gauss(mid, 3)))
        counts[inch] = counts.get(inch, 0) + 1
    return {"species": sp, "fishCount": [[k, counts[k]] for k in sorted(counts)]}


def standard_survey(year: int, q: dict[str, float], gill_sp: list[str], trap_sp: list[str], *, typ: str = "Standard Survey", sub: str | None = None, electro: list[str] | None = None, lengths: bool = False) -> dict:
    month = rng.choice([6, 7, 8])
    day = rng.randint(1, 28)
    nets_g = rng.choice([6, 9, 12, 15])
    nets_t = rng.choice([6, 9, 12])
    rows = [catch_row(sp, "gill", q.get(sp, 1), year, nets_g, ranges=year >= 1993) for sp in gill_sp]
    rows += [catch_row(sp, "trap", q.get(sp, 1), year, nets_t, ranges=year >= 1993) for sp in trap_sp]
    if electro:
        runs, hrs = rng.choice([(4, 2.0), (6, 3.0), (8, 4.0)])
        rows += [catch_row(sp, "electro", q.get(sp, 1), year, runs, hrs) for sp in electro]
    lens = None
    if lengths:
        lens = {sp: lengths_for(sp, 40, {"WAE": 15, "NOP": 22, "YEP": 7, "BLG": 6, "LMB": 12}.get(sp, 9)) for sp in (gill_sp[:2] if gill_sp else trap_sp[:1])}
    return survey(f"{year}-{month:02d}-{day:02d}", typ, rows, sub, lens)


def quality(species: list[str]) -> dict[str, float]:
    return {sp: math.exp(rng.gauss(0, 0.6)) for sp in species}


ALL = ["WAE", "NOP", "YEP", "TLC", "WTS", "BLB", "BLC", "RKB", "BLG", "PMK", "LMB", "SMB", "HSF", "MUE", "LAT"]


def build_mn() -> tuple[list[dict], dict[str, object]]:
    """25 lakes (+ a sub-basin): [{dow, name, lat, lng, has_point}], {dow: survey JSON or raw text}."""
    lakes = []
    answers: dict[str, object] = {}
    for i, nm in enumerate(NAMES):
        dow = f"99{i + 1:02d}{(i + 1) * 3 % 100:02d}00"
        lat, lng = lake_point(i)
        lakes.append({"dow": dow, "name": f"Fixture Lake {nm}", "county": "Fixture County", "lat": lat, "lng": lng, "has_point": True})
    by = {lk["name"].split()[-1]: lk for lk in lakes}

    def result(lk, surveys, *, area=None, depth=None, clarity=None):
        r = {"lakeName": lk["name"], "countyName": lk["county"]}
        if area:
            r["areaAcres"] = area
        if depth:
            r["maxDepth"] = depth
        if clarity:
            r["averageWaterClarity"] = clarity
        r["surveys"] = surveys
        return {"status": "SUCCESS", "result": r}

    # Alpha: big walleye lake, surveys over decades, lengths in the latest.
    q = quality(ALL)
    q["WAE"] = 2.2
    a = by["Alpha"]
    answers[a["dow"]] = result(
        a,
        [standard_survey(y, q, ["WAE", "NOP", "YEP", "TLC", "WTS"], ["BLG", "BLC", "PMK", "RKB"], typ=t, lengths=(y == 2022)) for y, t in [(1988, "Standard Survey"), (1996, "Population Assessment"), (2005, "Standard Survey"), (2014, "Population Assessment"), (2022, "Standard Survey")]],
        area=5210.4,
        depth=78,
        clarity=11.5,
    )
    # Bravo: panfish/bass lake with electrofishing in the latest survey.
    q = quality(ALL)
    q.update({"BLG": 2.0, "LMB": 1.8, "WAE": 0.4})
    b = by["Bravo"]
    answers[b["dow"]] = result(
        b,
        [standard_survey(2009, q, ["NOP", "YEP", "WAE"], ["BLG", "BLC", "PMK", "LMB"]), standard_survey(2016, q, ["NOP", "YEP", "WAE"], ["BLG", "BLC", "PMK", "LMB"]), standard_survey(2023, q, ["NOP", "YEP"], ["BLG", "BLC", "LMB"], electro=["LMB", "BLG"], lengths=True)],
        area=640.0,
        depth=34,
        clarity=8.0,
    )
    # Charlie: gill nets only.
    q = quality(ALL)
    c = by["Charlie"]
    answers[c["dow"]] = result(c, [standard_survey(y, q, ["WAE", "NOP", "YEP", "WTS"], []) for y in (2001, 2019)], area=1180.0, depth=41)
    # Delta: electrofishing-only special assessment plus one standard survey.
    q = quality(ALL)
    q["SMB"] = 2.5
    d = by["Delta"]
    electro_only = standard_survey(2021, q, [], [], typ="Special Assessment", sub="Bass Electrofishing", electro=["SMB", "LMB", "PMK"])
    answers[d["dow"]] = result(d, [standard_survey(2012, q, ["WAE", "NOP", "SMB", "RKB"], ["BLG", "RKB", "PMK"]), electro_only], area=870.5, depth=55, clarity=14.0)
    # Echo: whole lake with surveys; its east basin (sub-basin 01) has none of its own.
    q = quality(ALL)
    e = by["Echo"]
    answers[e["dow"]] = result(e, [standard_survey(y, q, ["WAE", "NOP", "YEP", "TLC"], ["BLG", "BLC"]) for y in (1999, 2010, 2020)], area=3300.0, depth=60, clarity=9.0)
    sub = {"dow": e["dow"][:6] + "01", "name": "Fixture Lake Echo (East Basin)", "county": "Fixture County", "lat": round(e["lat"] + 0.03, 5), "lng": round(e["lng"] + 0.05, 5), "has_point": True}
    lakes.append(sub)
    answers[sub["dow"]] = {"status": "ERROR", "message": "The requested lake survey data is not available."}
    # Foxtrot: CPUE only (no net counts, no totals).
    q = quality(ALL)
    f = by["Foxtrot"]
    s1 = standard_survey(1994, q, ["WAE", "NOP", "YEP"], ["BLG", "BLC"])
    for r in s1["fishCatchSummaries"]:
        r.pop("gearCount")
        r.pop("totalCatch")
    answers[f["dow"]] = result(f, [s1], area=410.0)
    # Golf: LakeFinder answered with an HTML error page (parse failure -> gaps).
    answers[by["Golf"]["dow"]] = "<html><body><h1>500 Internal Server Error</h1><p>Fixture: simulated broken answer.</p></body></html>"
    # Hotel: no survey at all.
    answers[by["Hotel"]["dow"]] = {"status": "ERROR", "message": "No lake survey found"}
    # India: no point anywhere (a launch with its DOW gives one).
    i_ = by["India"]
    i_["has_point"] = False
    q = quality(ALL)
    answers[i_["dow"]] = result(i_, [standard_survey(2017, q, ["WAE", "NOP", "YEP"], ["BLG", "BLC"])], area=220.0, depth=18)
    # Juliett: muskie lake.
    q = quality(ALL)
    q["MUE"] = 3.0
    j = by["Juliett"]
    answers[j["dow"]] = result(j, [standard_survey(y, q, ["MUE", "NOP", "WAE", "YEP"], ["BLG", "BLC"]) for y in (2003, 2018)], area=2400.0, depth=48, clarity=7.5)
    # Kilo: deep trout lake.
    q = quality(ALL)
    k = by["Kilo"]
    answers[k["dow"]] = result(k, [standard_survey(y, q, ["LAT", "TLC", "WTS", "NOP"], []) for y in (1991, 2008, 2024)], area=950.0, depth=140, clarity=22.0)
    # Lima: one survey with no date (skipped, logged), one fine.
    q = quality(ALL)
    l_ = by["Lima"]
    bad = standard_survey(2000, q, ["WAE", "NOP"], ["BLG"])
    bad["surveyDate"] = ""
    answers[l_["dow"]] = result(l_, [bad, standard_survey(2015, q, ["WAE", "NOP", "YEP"], ["BLG", "BLC"])], area=300.0)
    # Mike: panfish only, no walleye ever.
    q = quality(ALL)
    q["BLG"] = 1.7
    m = by["Mike"]
    answers[m["dow"]] = result(m, [standard_survey(y, q, ["NOP", "YEP", "BLB"], ["BLG", "BLC", "PMK", "HSF"]) for y in (2006, 2013, 2021)], area=180.0, depth=22, clarity=6.0)
    # November: shallow, murky perch/bullhead lake.
    q = quality(ALL)
    q.update({"BLB": 3.0, "YEP": 1.5})
    nv = by["November"]
    answers[nv["dow"]] = result(nv, [standard_survey(y, q, ["YEP", "BLB", "NOP", "WAE"], ["BLB", "BLC"]) for y in (1997, 2011)], area=760.0, depth=9, clarity=1.8)
    # The rest: ordinary lakes with 0-4 surveys and varied species.
    for nm in NAMES[14:]:
        lk = by[nm]
        q = quality(ALL)
        n = rng.choice([0, 1, 2, 2, 3, 4])
        years = sorted(rng.sample(range(1986, 2025), n))
        gill = rng.sample(["WAE", "NOP", "YEP", "TLC", "WTS", "BLB", "SMB"], rng.randint(2, 5))
        trap = rng.sample(["BLG", "BLC", "PMK", "LMB", "RKB", "HSF"], rng.randint(0, 4))
        if n == 0:
            answers[lk["dow"]] = {"status": "ERROR", "message": "No lake survey found"}
            continue
        feats = {}
        if rng.random() < 0.8:
            feats["area"] = round(math.exp(rng.uniform(4, 8)), 1)
        if rng.random() < 0.7:
            feats["depth"] = rng.randint(8, 90)
        if rng.random() < 0.5:
            feats["clarity"] = round(rng.uniform(2, 18), 1)
        answers[lk["dow"]] = result(lk, [standard_survey(y, q, gill, trap, typ=rng.choice(["Standard Survey", "Population Assessment"])) for y in years], **feats)
    return lakes, answers


def write_mn(lakes, answers) -> None:
    # by_point grid exactly as the pipeline asks for it.
    pts = grid_points(intersect(S.MN_BOX, MN_BOX), S.LF_GRID_KM)
    rad = radius_m(S.LF_GRID_KM) / 1000
    homeless_done = set()
    for k, (lat, lng) in enumerate(pts):
        res = []
        for lk in lakes:
            if distance_km((lat, lng), (lk["lat"], lk["lng"])) > rad:
                continue
            if lk["has_point"]:
                res.append({"name": lk["name"], "id": lk["dow"], "county": lk["county"], "point": {"epsg:4326": [lk["lng"], lk["lat"]]}})
            elif lk["dow"] not in homeless_done:
                homeless_done.add(lk["dow"])
                res.append({"name": lk["name"], "id": lk["dow"], "county": lk["county"]})
        put(S.lf_by_point_url(lat, lng, radius_m(S.LF_GRID_KM)), f"mn/by_point/p{k:02d}.json", js({"status": "OK", "results": res}))
    for lk in lakes:
        a = answers[lk["dow"]]
        if isinstance(a, str):
            put(S.lf_survey_url(lk["dow"]), f"mn/survey/{lk['dow']}.html", a, ctype="text/html")
        else:
            put(S.lf_survey_url(lk["dow"]), f"mn/survey/{lk['dow']}.json", js(a))
    # LakeFinder's lake page and script, from which stocking/regulation detail types are discovered.
    page = '<!doctype html><html><head><title>Fixture LakeFinder page</title><script src="/lakefind/js/fixture-lakefinder.js"></script></head><body>Synthetic fixture page.</body></html>'
    script = (
        "// Synthetic fixture script (not LakeFinder's real code).\n"
        "function loadSurvey(id){ return get('/cgi-bin/lakefinder/detail.cgi?type=lake_survey&callback=&id=' + id); }\n"
        "function loadStocking(id){ return get('/cgi-bin/lakefinder/detail.cgi?type=fixture_fish_stocking&callback=&id=' + id); }\n"
        "function loadRegs(id){ return get('/cgi-bin/lakefinder/detail.cgi?type=fixture_special_regs&callback=&id=' + id); }\n"
    )
    for lk in lakes:
        put(S.lf_page_url(lk["dow"]), "mn/lake_page.html", page, ctype="text/html")
    put("https://www.dnr.state.mn.us/lakefind/js/fixture-lakefinder.js", "mn/fixture-lakefinder.js", script, ctype="application/javascript")
    # Stocking (assumed shape) for a few lakes; empty answers for the rest.
    stocked = {"Alpha": [("WAE", "fry", 1_000_000), ("WAE", "fingerling", 18_000)], "Echo": [("WAE", "fingerling", 9_000)], "Juliett": [("MUE", "fingerling", 600)], "Kilo": [("LAT", "yearling", 4_000), ("RBT", "yearling", 2_500)], "November": [("WAE", "fry", 250_000)], "Charlie": [("Walleye", "fingerling", 7_500)]}
    for lk in lakes:
        nm = lk["name"].replace("Fixture Lake ", "")
        rows = []
        for sp, size, base in stocked.get(nm, []):
            for y in sorted(rng.sample(range(2012, 2026), 3)):
                rows.append({"year": y, "species": sp, "size": size, "number": int(base * rng.uniform(0.6, 1.3))})
        put(S.lf_detail_url("fixture_fish_stocking", lk["dow"]), f"mn/stocking/{lk['dow']}.json", js({"status": "SUCCESS", "result": {"stocking": rows}}))
    regs = {
        "Alpha": [{"species": "WAE", "regulation": "FIXTURE TEXT (synthetic, not a real rule): walleye protected slot example for tests."}],
        "Juliett": [{"species": "Muskellunge", "regulation": "FIXTURE TEXT (synthetic, not a real rule): muskellunge minimum size example for tests."}, {"species": None, "regulation": "FIXTURE TEXT (synthetic): electric motors only example for tests."}],
        "Kilo": [{"species": "LAT", "regulation": "FIXTURE TEXT (synthetic, not a real rule): lake trout season example for tests."}],
    }
    for lk in lakes:
        nm = lk["name"].replace("Fixture Lake ", "")
        put(S.lf_detail_url("fixture_special_regs", lk["dow"]), f"mn/regs/{lk['dow']}.json", js({"status": "SUCCESS", "result": {"specialRegulations": regs.get(nm, [])}}))


def write_mn_access(lakes) -> None:
    service, _ = S.WATER_ACCESS_SERVICES[0]
    layer = {"id": 0, "name": "Water Access Sites", "geometryType": "esriGeometryPoint", "maxRecordCount": 20, "objectIdField": "OBJECTID", "fields": [{"name": "OBJECTID", "type": "esriFieldTypeOID"}]}
    put(f"{service}/layers?f=json", "mn/access/layers.json", js({"layers": [layer]}))
    ramps = ["Concrete", "Gravel", "Carry-in", "Concrete Plank", "", "Natural", "Bituminous", "Carry-In Only", "Concrete"]
    feats = []
    oid = 1
    for i, lk in enumerate(lakes):
        if lk["name"].endswith("(East Basin)"):
            continue
        n = 2 if i % 3 == 0 else 1
        for j in range(n):
            lat = lk["lat"] + rng.uniform(-0.02, 0.02)
            lng = lk["lng"] + rng.uniform(-0.03, 0.03)
            attrs = {"OBJECTID": oid, "ACCESS_NAME": f"{lk['name']} Access {'NS'[j]}", "LAKE_NAME": lk["name"].replace("Fixture Lake ", "") , "DOW_NUM": lk["dow"], "RAMP_TYPE": ramps[(i + j) % len(ramps)], "ADMIN": "Fixture DNR"}
            if i % 7 == 3:  # no DOW: matched by lake name and distance
                attrs["DOW_NUM"] = None
                attrs["LAKE_NAME"] = lk["name"]
            if i % 11 == 5:  # 6-digit basin id
                attrs["DOW_NUM"] = lk["dow"][:6]
            feats.append({"attributes": attrs, "geometry": {"x": round(lng, 6), "y": round(lat, 6)}})
            oid += 1
    sub = next(lk for lk in lakes if lk["name"].endswith("(East Basin)"))
    feats.append({"attributes": {"OBJECTID": oid, "ACCESS_NAME": "Fixture East Basin Access", "LAKE_NAME": "Fixture Lake Echo", "DOW_NUM": sub["dow"], "RAMP_TYPE": "Concrete", "ADMIN": "Fixture County"}, "geometry": {"x": sub["lng"], "y": sub["lat"]}})
    oid += 1
    feats.append({"attributes": {"OBJECTID": oid, "ACCESS_NAME": "Fixture Pond Unlisted Access", "LAKE_NAME": "Fixture Pond Unlisted", "DOW_NUM": "99999900", "RAMP_TYPE": "Gravel", "ADMIN": "Fixture DNR"}, "geometry": {"x": -94.0, "y": 47.2}})
    oid += 1
    feats.append({"attributes": {"OBJECTID": oid, "ACCESS_NAME": "Fixture Lake Alpha Access N", "LAKE_NAME": "Alpha", "DOW_NUM": lakes[0]["dow"], "RAMP_TYPE": "Concrete", "ADMIN": "Fixture DNR"}, "geometry": dict(feats[0]["geometry"])})  # exact duplicate record
    box = intersect(S.MN_BOX, MN_BOX)
    page = layer["maxRecordCount"]
    for k in range(0, len(feats) + 1, page):
        chunk = feats[k : k + page]
        more = k + page < len(feats)
        put(query_url(f"{service}/0", offset=k, count=page, bbox=box, order_by="OBJECTID"), f"mn/access/query_{k // page}.json", js({"features": chunk, "exceededTransferLimit": more} if more else {"features": chunk}))
        if not more:
            break


# ====================================================================== SD

SD_LAKES = [
    # name, lat, lng, radius km, reports
    ("Fixture Lake Amber", 44.12, -97.45, 1.6),
    ("Fixture Lake Basswood", 44.22, -97.30, 0.9),
    ("Fixture Lake Cottonwood", 44.35, -97.52, 1.1),
    ("Fixture Flats Reservoir", 44.48, -97.20, 1.4),
    ("Fixture Lake Elm", 44.08, -97.05, 0.7),
    ("Fixture Lake Fox", 44.30, -96.92, 1.0),
    ("Fixture Lake Granite", 44.52, -97.40, 1.8),
    ("Fixture Lake Heron", 44.42, -96.98, 0.8),
]


def ring(lat: float, lng: float, r_km: float, n: int = 16) -> list[dict]:
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n
        rr = r_km * (1 + 0.15 * math.sin(3 * t))
        pts.append({"lat": round(lat + rr * math.sin(t) / 111.0, 6), "lon": round(lng + rr * math.cos(t) / (111.0 * math.cos(math.radians(lat))), 6)})
    return pts + [pts[0]]


def bounds(pts: list[dict]) -> dict:
    return {"minlat": min(p["lat"] for p in pts), "minlon": min(p["lon"] for p in pts), "maxlat": max(p["lat"] for p in pts), "maxlon": max(p["lon"] for p in pts)}


def osm_elements() -> tuple[list[dict], list[dict]]:
    waters, slips = [], []
    for k, (name, lat, lng, r) in enumerate(SD_LAKES):
        oid = 900000010 + k
        pts = ring(lat, lng, r)
        tags = {"natural": "water", "water": "lake" if "Reservoir" not in name else "reservoir", "name": name}
        if name == "Fixture Lake Granite":  # multipolygon: outer ring split in two ways, plus an island
            half = len(pts) // 2
            members = [
                {"type": "way", "ref": 900000101, "role": "outer", "geometry": pts[: half + 1]},
                {"type": "way", "ref": 900000102, "role": "outer", "geometry": pts[half:]},
                {"type": "way", "ref": 900000103, "role": "inner", "geometry": ring(lat, lng + 0.005, 0.4, 8)},
            ]
            waters.append({"type": "relation", "id": 900000200, "bounds": bounds(pts), "members": members, "tags": {**tags, "type": "multipolygon"}})
        else:
            waters.append({"type": "way", "id": oid, "bounds": bounds(pts), "geometry": pts, "tags": tags})
    tiny = ring(44.25, -97.10, 0.08, 8)
    waters.append({"type": "way", "id": 900000050, "bounds": bounds(tiny), "geometry": tiny, "tags": {"natural": "water", "name": "Fixture Pond Tiny"}})
    creek = ring(44.40, -97.10, 0.5, 8)
    waters.append({"type": "way", "id": 900000051, "bounds": bounds(creek), "geometry": creek, "tags": {"natural": "water", "water": "river", "name": "Fixture Creek"}})
    dup = ring(44.55, -97.05, 0.3, 8)
    waters.append({"type": "way", "id": 900000052, "bounds": bounds(dup), "geometry": dup, "tags": {"natural": "water", "water": "lake", "name": "Fixture Lake Amber"}})
    # Slipways: one next to a GFP ramp (dropped as duplicate), others OSM-only.
    slips.append({"type": "node", "id": 900000301, "lat": 44.1201, "lon": -97.4310, "tags": {"leisure": "slipway", "surface": "concrete"}})
    slips.append({"type": "node", "id": 900000302, "lat": 44.0835, "lon": -97.0545, "tags": {"leisure": "slipway", "surface": "gravel", "name": "Fixture Elm Ramp"}})
    slips.append({"type": "way", "id": 900000303, "center": {"lat": 44.3070, "lon": -96.9250}, "tags": {"leisure": "slipway", "access": "private"}})
    slips.append({"type": "node", "id": 900000304, "lat": 44.2000, "lon": -96.85, "tags": {"leisure": "slipway"}})  # not near any lake
    return waters, slips


def write_osm() -> None:
    waters, slips = osm_elements()
    box = intersect(S.SD_BOX, SD_BOX)
    for k, t in enumerate(tiles(box, S.OSM_TILE_DEG)):
        w, s, e, n = t

        def inside(lat, lon, pad=0.0):
            return s - pad <= lat <= n + pad and w - pad <= lon <= e + pad

        ws = []
        for el in waters:
            b = el["bounds"]
            if b["minlat"] <= n and b["maxlat"] >= s and b["minlon"] <= e and b["maxlon"] >= w:
                ws.append(el)
        ss = [el for el in slips if inside(el.get("lat", el.get("center", {}).get("lat")), el.get("lon", el.get("center", {}).get("lon")))]
        data = {"version": 0.6, "generator": "Fixture (synthetic)", "osm3s": {"copyright": "Synthetic fixture data, shaped like Overpass API output."}, "elements": ws + ss}
        put(S.OVERPASS_URL, f"sd/overpass/tile_{k}.json", js(data), method="POST", body=urlencode({"data": overpass_query(t)}))


def gfp_list_html(rows: list[tuple[str, str, str]]) -> str:
    body = "".join(f'<tr><td>{year}</td><td>{kind}</td><td><a href="ExportPDF.ashx?ReportID={rid}">{text}</a></td></tr>' for rid, year, kind, text in [(r[0], r[1], r[2], r[3]) for r in rows]) if rows else ""
    return f"<!doctype html><html><body><h1>Fixture Fishery Reports (synthetic)</h1><table>{body}</table></body></html>"


def report_pdf(name: str, year: int | None, gill: dict[str, float], frame: dict[str, float], electro: dict[str, float] | None = None, *, table: bool = True, date_line: str | None = None) -> bytes:
    lines: list[tuple[float, float, str]] = [(72, 740, f"{name} Survey Summary")]
    y = 720
    if year:
        lines.append((72, y, str(year)))
        y -= 20
    if date_line:
        lines.append((72, y, date_line))
        y -= 20
    sp_g = sorted(gill.items(), key=lambda kv: -kv[1])
    if sp_g:
        sp, v = sp_g[0]
        lines.append((72, y, f"{sp} relative abundance in this synthetic fixture was {v:.1f} per gill net, and"))
        lines.append((72, y - 14, "other species were present in smaller numbers in the nets set this year."))
        y -= 28
    if frame:
        sp, v = sorted(frame.items(), key=lambda kv: -kv[1])[0]
        lines.append((72, y, f"{sp} were common ({v:.1f}/frame net) in the synthetic fixture sample."))
        y -= 28
    if table:
        lines.append((72, y, f"Table 1. Mean CPUE of fish captured in gill nets and frame nets, {name}."))
        y -= 20
        for heading, rows in (("Gill nets", gill), ("Frame nets", frame), ("Electrofishing", electro or {})):
            if not rows:
                continue
            lines.append((72, y, heading))
            y -= 14
            lines += [(72, y, "Species"), (250, y, "CPUE"), (320, y, "PSD")]
            y -= 14
            for sp, v in rows.items():
                lines += [(72, y, sp), (250, y, f"{v:.1f}"), (320, y, str(rng.randint(10, 80)))]
                y -= 14
            y -= 6
    return make_pdf(lines)


def cpues(species: list[str], scale: float = 1.0) -> dict[str, float]:
    base = {"Walleye": 8, "Northern Pike": 4, "Yellow Perch": 20, "Bluegill": 25, "Black Crappie": 5, "White Bass": 3, "Smallmouth Bass": 1.5, "Largemouth Bass": 1, "Common Carp": 2, "Black Bullhead": 12, "Orangespotted Sunfish": 6, "Channel Catfish": 1.2}
    return {sp: round(base[sp] * scale * math.exp(rng.gauss(0, 0.5)), 1) for sp in species}


def write_gfp() -> None:
    lists: dict[str, list[tuple[str, str, str, str]]] = {}
    pdfs: dict[str, bytes] = {}
    rid = 900100

    def report(name, year, kind="Lake Survey", text=None):
        nonlocal rid
        rid += 1
        lists.setdefault(name, []).append((str(rid), str(year), kind, text or f"{name} {kind} {year}"))
        return str(rid)

    # Amber: three surveys plus creel and stocking reports (skipped).
    for yr, sc in ((2016, 0.8), (2019, 1.1), (2022, 1.4)):
        r = report("Fixture Lake Amber", yr)
        pdfs[r] = report_pdf("Fixture Lake Amber", yr, cpues(["Walleye", "Northern Pike", "Yellow Perch"], sc), cpues(["Bluegill", "Black Crappie"], sc), date_line="Sampling dates: June 14, 2022" if yr == 2022 else None)
    report("Fixture Lake Amber", 2020, "Creel Survey", "Fixture Lake Amber Angler Creel Survey 2020")
    report("Fixture Lake Amber", 2021, "Stocking", "Fixture Lake Amber Stocking Report 2021")
    # Basswood: summary sentences only.
    r = report("Fixture Lake Basswood", 2018)
    pdfs[r] = make_pdf([(72, 740, "Fixture Lake Basswood Survey Summary 2018"), (72, 720, "Walleye numbers were low (1.8/gill net) and northern pike were common (4.2 per gill net)."), (72, 706, "Bluegill were abundant (61.5/frame net) in the sample taken.")])
    # Cottonwood: newest PDF is broken, older one fine.
    r = report("Fixture Lake Cottonwood", 2015)
    pdfs[r] = report_pdf("Fixture Lake Cottonwood", 2015, cpues(["Walleye", "Yellow Perch", "White Bass"]), cpues(["Black Crappie", "Bluegill"]))
    r = report("Fixture Lake Cottonwood", 2021)
    pdfs[r] = b"%PDF-1.4\n% synthetic broken fixture file\n1 0 obj\n<< /Type /Catalog"
    # Flats: found only under the bare name ("Fixture Flats").
    r = report("Fixture Flats", 2020)
    pdfs[r] = report_pdf("Fixture Flats Reservoir", 2020, cpues(["Walleye", "Channel Catfish", "Common Carp"]), cpues(["Black Crappie", "Black Bullhead"]))
    # Elm: no reports (empty list pages for both names).
    lists.setdefault("Fixture Lake Elm", [])
    # Fox: electrofishing table and a species without a DNR code.
    r = report("Fixture Lake Fox", 2023)
    pdfs[r] = report_pdf("Fixture Lake Fox", 2023, cpues(["Walleye", "Northern Pike"]), cpues(["Bluegill", "Orangespotted Sunfish"]), {"Smallmouth Bass": 22.5, "Largemouth Bass": 14.0})
    # Granite: one survey.
    r = report("Fixture Lake Granite", 2017)
    pdfs[r] = report_pdf("Fixture Lake Granite", 2017, cpues(["Walleye", "Yellow Perch", "Northern Pike", "Smallmouth Bass"], 0.7), cpues(["Bluegill", "Black Crappie"]))
    # Heron: no year inside the PDF; the report list says 2008.
    r = report("Fixture Lake Heron", 2008)
    pdfs[r] = report_pdf("Fixture Lake Heron", None, cpues(["Walleye", "Yellow Perch"], 0.6), cpues(["Black Crappie"]))

    asked: set[str] = set()
    for name, *_ in SD_LAKES:
        for v in water_name_variants(name):
            if v in asked:
                continue
            asked.add(v)
            rows = lists.get(v, [])
            put(S.gfp_list_url(v), f"sd/gfp/list_{v.replace(' ', '_')}.html", gfp_list_html(rows), ctype="text/html")
    for r, data in pdfs.items():
        put(S.gfp_pdf_url(r), f"sd/gfp/report_{r}.pdf", data, ctype="application/pdf")


def write_gfp_gis() -> None:
    put(f"{S.SD_GFP_SERVER}/Parks?f=json", "sd/gis/folder_parks.json", js({"currentVersion": 10.9, "services": [{"name": "Parks/Fixture_Campgrounds", "type": "MapServer"}, {"name": "Parks/FixtureBoatRamps", "type": "FeatureServer"}]}))
    put(f"{S.SD_GFP_SERVER}/Public_Lands?f=json", "sd/gis/folder_public_lands.json", js({"currentVersion": 10.9, "services": []}))
    base = f"{S.SD_GFP_SERVER}/Parks/FixtureBoatRamps/FeatureServer"
    layer = {"id": 0, "name": "Boat Ramps", "geometryType": "esriGeometryPoint", "maxRecordCount": 1000, "objectIdField": "OBJECTID"}
    put(f"{base}/layers?f=json", "sd/gis/ramps_layers.json", js({"layers": [layer]}))
    feats = [
        ("Fixture Amber North Ramp", "Fixture Lake Amber", "Concrete", 44.1200, -97.4300),
        ("Fixture Amber South Access", "Amber", "Gravel", 44.1050, -97.4600),
        ("Fixture Basswood Ramp", "Fixture Lake Basswood", "Concrete", 44.2290, -97.3000),
        ("Fixture Cottonwood Access", "", "Gravel", 44.3480, -97.5080),  # no water name: nearest lake
        ("Fixture Flats Dam Ramp", "Fixture Flats", "Concrete", 44.4900, -97.1850),
        ("Fixture Granite Ramp", "Fixture Lake Granite", "Concrete", 44.5350, -97.4000),
        ("Fixture Heron Canoe Access", "Fixture Lake Heron", "Carry-in only", 44.4250, -96.9900),
        ("Fixture Far Away Ramp", "Fixture Unknown Water", "Concrete", 44.0200, -97.5900),  # matches nothing
    ]
    out = [{"attributes": {"OBJECTID": k + 1, "NAME": n, "LAKE": w, "RAMP_TYPE": r}, "geometry": {"x": lng, "y": lat}} for k, (n, w, r, lat, lng) in enumerate(feats)]
    box = intersect(S.SD_BOX, SD_BOX)
    put(query_url(f"{base}/0", offset=0, count=1000, bbox=box, order_by="OBJECTID"), "sd/gis/ramps_query_0.json", js({"features": out}))


def main() -> None:
    global OUT
    if len(sys.argv) > 1:
        OUT = Path(sys.argv[1]).resolve()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    lakes, answers = build_mn()
    write_mn(lakes, answers)
    write_mn_access(lakes)
    write_osm()
    write_gfp()
    write_gfp_gis()
    index = {
        "note": "SYNTHETIC fixtures: fake lakes ('Fixture Lake ...', DOW 99xxxxxx), made-up numbers. Generated by fixtures/make_raw.py.",
        "bbox": {"MN": list(MN_BOX), "SD": list(SD_BOX)},
        "entries": entries,
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(entries)} fixture responses to {OUT}")


if __name__ == "__main__":
    main()
