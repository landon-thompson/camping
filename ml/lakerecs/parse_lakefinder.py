"""MN DNR LakeFinder JSON parsing, ported from ``src/features/fishing/lakeSurvey.ts``.

Field meanings are identical to the app (parity tests in
``tests/test_data_lakefinder.py`` use the JSON from ``lakeSurvey.test.ts``).
The JSON layout isn't formally documented, so keys are matched loosely
(``get`` ignores case and punctuation) exactly like the TS ``get()``.

Beyond the app: lake features, length distributions, stocking and special
regulations. Their keys are not confirmed (``verify`` in ``sources.VERIFY``).
"""

from __future__ import annotations

import html
import json
import math
import re
from typing import Any

from .species import SPECIES, code_for_name

Obj = dict[str, Any]


class NoSurvey(Exception):
    """LakeFinder answered, but has no survey for the lake (its message)."""


def norm(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def get(o: Obj, *names: str) -> Any:
    """First entry (in the object's own key order) whose normalised key is one of ``names``; like TS ``get``."""
    want = {norm(n) for n in names}
    for k, v in o.items():
        if norm(k) in want:
            return v
    return None


def js_str(v: Any) -> str:
    """TS ``str()``: '' for null/undefined, else String(v).trim()."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def num(v: Any) -> float | None:
    """TS ``num()``, except that text with no digits at all ("N/A", "-") is null, not 0 (the TS ``Number('')`` quirk)."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    s = re.sub(r"[^0-9.-]", "", str(v))
    if not re.search(r"\d", s):
        return None
    try:
        n = float(s)
    except ValueError:
        return None
    return n if math.isfinite(n) else None


_RANGE = re.compile(r"(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)")


def parse_range(v: Any) -> tuple[float | None, float | None]:
    """'3.3-10.5' -> (3.3, 10.5); anything else -> (None, None)."""
    m = _RANGE.search(js_str(v))
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


def parse_json_loose(text: str) -> Any:
    """JSON, or JSONP-wrapped JSON (``callback({...})``)."""
    try:
        return json.loads(text)
    except ValueError:
        a = text.find("{")
        b = text.rfind("}")
        if a >= 0 and b > a:
            return json.loads(text[a : b + 1])
        raise ValueError("Not JSON")


# ------------------------------------------------------------------ gear


def gear_family_label(gear: str) -> str:
    """Exactly ``gearFamily()`` in lakeSurvey.ts."""
    if re.search(r"gill", gear, re.I):
        return "Gill nets"
    if re.search(r"trap", gear, re.I):
        return "Trap nets"
    if re.search(r"electro|boat ?shock", gear, re.I):
        return "Electrofishing"
    if re.search(r"seine", gear, re.I):
        return "Seines"
    return gear or "Other"


_FAMILY = {"Gill nets": "gill", "Trap nets": "trap", "Electrofishing": "electro", "Seines": "seine"}


def gear_family(gear: str) -> str:
    """gill / trap / electro / seine / other: ``gearFamily()``'s rules, plus SD "frame net" = trap (as in sdParse's ``gearOf``)."""
    fam = _FAMILY.get(gear_family_label(gear))
    if fam:
        return fam
    if re.search(r"frame\s*net", gear, re.I):
        return "trap"
    return "other"


# ------------------------------------------------------------------ lake survey (app parity)


def parse_lake_survey(data: Any, dow: str) -> Obj:
    """Same result as ``parseLakeSurvey`` (camelCase keys; no fetchedAt/v). Raises ``NoSurvey``."""
    if not isinstance(data, dict):
        raise NoSurvey("LakeFinder sent no data")
    result = get(data, "result")
    if not isinstance(result, dict):
        raise NoSurvey(js_str(get(data, "message")) or "LakeFinder has no survey for that lake")
    raw_surveys = get(result, "surveys") or []
    surveys = []
    for s in raw_surveys if isinstance(raw_surveys, list) else []:
        if not isinstance(s, dict):
            continue
        rows = get(s, "fishCatchSummaries", "catchSummaries") or []
        catches = []
        for r in rows if isinstance(rows, list) else []:
            if not isinstance(r, dict):
                continue
            lo, hi = parse_range(get(r, "quartileCount", "quartileRange"))
            wlo, whi = parse_range(get(r, "quartileWeight"))
            c = {
                "species": js_str(get(r, "species", "speciesCode")).upper(),
                "gear": js_str(get(r, "gear", "gearType")),
                "gearCount": num(get(r, "gearCount")),
                "totalCatch": num(get(r, "totalCatch")),
                "cpue": num(get(r, "CPUE", "catchPerUnitEffort")),
                "normalLow": lo,
                "normalHigh": hi,
                "avgWeightLb": num(get(r, "averageWeight")),
                "normalWeightLow": wlo,
                "normalWeightHigh": whi,
            }
            if c["species"]:
                catches.append(c)
        surveys.append(
            {
                "date": js_str(get(s, "surveyDate", "date"))[:10],
                "type": " · ".join(x for x in (js_str(get(s, "surveyType")), js_str(get(s, "surveySubType"))) if x),
                "catches": catches,
                "_raw": s,
            }
        )
    surveys.sort(key=lambda x: x["date"], reverse=True)
    return {"dow": dow, "lakeName": js_str(get(result, "lakeName", "name")) or f"Lake {dow}", "surveys": surveys, "_result": result}


def latest_with_catch(parsed: Obj) -> Obj | None:
    return next((s for s in parsed["surveys"] if s["catches"]), None)


# ------------------------------------------------------------------ lake features (verify)


def lake_features(result: Obj) -> Obj:
    """Area, depth, clarity, county, region and a point from the survey JSON's ``result``, when present (keys: verify)."""
    point = find_point(result)
    region = js_str(get(result, "fisheriesRegion", "fishRegion", "dnrRegion", "region", "ecoregion"))
    return {
        "area_acres": _pos(num(get(result, "areaAcres", "area", "lakeArea", "acres", "areaInAcres"))),
        "max_depth_ft": _pos(num(get(result, "maxDepthFeet", "maxDepth", "maximumDepth", "maxDepthFt", "depthMax"))),
        "clarity_ft": _pos(num(get(result, "averageWaterClarity", "waterClarity", "secchiDepth", "secchi", "clarity", "meanClarity", "secchiFeet"))),
        "county": js_str(get(result, "countyName", "county")),
        "region": region,
        "lat": point[0] if point else None,
        "lng": point[1] if point else None,
    }


def _pos(v: float | None) -> float | None:
    return v if v is not None and v > 0 else None


# ------------------------------------------------------------------ length distributions (verify)


def _pairs(v: Any) -> list[tuple[int, int]] | None:
    """[[inch, count], ...] or [{inch|length: n, count|number|fish: n}, ...] or {"<inch>": count}."""
    out: list[tuple[int, int]] = []
    if isinstance(v, dict):
        if all(re.fullmatch(r"\d+", str(k)) for k in v) and v:
            for k, c in v.items():
                n = num(c)
                if n is None:
                    return None
                out.append((int(k), int(n)))
            return sorted(out)
        return None
    if not isinstance(v, list) or not v:
        return None
    for item in v:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            a, b = num(item[0]), num(item[1])
        elif isinstance(item, dict):
            a, b = num(get(item, "inch", "inches", "length", "lengthInches", "lengthClass", "size")), num(get(item, "count", "number", "fish", "fishCount", "n", "frequency"))
        else:
            return None
        if a is None or b is None or a < 0 or b < 0 or a != int(a) or b != int(b):
            return None
        out.append((int(a), int(b)))
    return sorted(out)


def survey_lengths(raw_survey: Obj) -> dict[tuple[str, str], list[tuple[int, int]]]:
    """Length distributions in one survey, keyed (species, gear) with gear '' when not given. Loose: any key containing 'length'."""
    out: dict[tuple[str, str], list[tuple[int, int]]] = {}
    for k, v in raw_survey.items():
        if "length" not in norm(k) or not isinstance(v, (dict, list)):
            continue
        if isinstance(v, dict):
            for sp, inner in v.items():
                code = sp.upper() if re.fullmatch(r"[A-Za-z]{3}", sp) else code_for_name(sp)
                if not code:
                    continue
                if isinstance(inner, dict) and inner and all(re.fullmatch(r"\d+", str(x)) for x in inner):
                    gear, pairs = "", _pairs(inner)  # {"<inch>": count}
                elif isinstance(inner, dict):
                    gear = js_str(get(inner, "gear", "gearType"))
                    pairs = _pairs(get(inner, "fishCount", "counts", "lengths", "distribution", "frequency"))
                else:
                    gear, pairs = "", _pairs(inner)
                if pairs:
                    out[(code, gear)] = pairs
        else:
            for item in v:
                if not isinstance(item, dict):
                    continue
                sp = js_str(get(item, "species", "speciesCode"))
                code = sp.upper() if re.fullmatch(r"[A-Za-z]{3}", sp) else code_for_name(sp)
                if not code:
                    continue
                gear = js_str(get(item, "gear", "gearType"))
                pairs = _pairs(get(item, "fishCount", "counts", "lengths", "distribution", "frequency"))
                if pairs is None:  # one row per (species, inch, count)
                    a, b = num(get(item, "inch", "inches", "length", "lengthInches")), num(get(item, "count", "number", "fish"))
                    if a is not None and b is not None:
                        out.setdefault((code, gear), []).append((int(a), int(b)))
                    continue
                if pairs:
                    out[(code, gear)] = pairs
    return {k: sorted(v) for k, v in out.items()}


# ------------------------------------------------------------------ by_point lake lists (app parity)

_IN_MN = lambda lat, lng: 43 < lat < 49.5 and -97.5 < lng < -89  # noqa: E731


def find_point(o: Any, depth: int = 0) -> tuple[float, float] | None:
    """(lat, lng) anywhere in a lake result: lat/lon fields or a [lon, lat] pair; like ``findPoint``."""
    if o is None or not isinstance(o, (dict, list)) or depth > 3:
        return None
    if isinstance(o, list):
        if len(o) == 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in o):
            if _IN_MN(o[1], o[0]):
                return (float(o[1]), float(o[0]))
            if _IN_MN(o[0], o[1]):
                return (float(o[0]), float(o[1]))
        return None
    lat = num(get(o, "lat", "latitude", "y"))
    lng = num(get(o, "lon", "lng", "long", "longitude", "x"))
    if lat is not None and lng is not None and _IN_MN(lat, lng):
        return (lat, lng)
    for k, v in o.items():
        if re.search(r"point|geom|location|coord|epsg|center|centroid", k, re.I):
            p = find_point(v, depth + 1)
            if p:
                return p
    return None


def parse_nearby_lakes(data: Any) -> list[Obj]:
    """Lakes in a by_point answer: any object with an 8-digit id and a name; like ``parseNearbyLakes``. Keeps the raw object as ``_raw``."""
    out: list[Obj] = []
    seen: set[str] = set()

    def walk(v: Any, depth: int) -> None:
        if depth > 6 or v is None or not isinstance(v, (dict, list)):
            return
        if isinstance(v, list):
            for x in v:
                walk(x, depth + 1)
            return
        id_ = re.sub(r"\D", "", js_str(get(v, "id", "dowNumber", "dow", "downum")))
        name = js_str(get(v, "name", "lakeName"))
        if len(id_) == 8 and name and id_ not in seen:
            seen.add(id_)
            p = find_point(v)
            out.append({"dow": id_, "name": name, "county": js_str(get(v, "county", "countyName")), "lat": p[0] if p else None, "lng": p[1] if p else None, "_raw": v})
            return
        for x in v.values():
            walk(x, depth + 1)

    walk(data, 0)
    return out


def format_dow(d: str) -> str:
    return re.sub(r"^(\d{2})(\d{4})(\d{2})$", r"\1-\2-\3", d)


# ------------------------------------------------------------------ detail-type discovery (verify)


def discover_detail_types(page_texts: list[str]) -> list[str]:
    """``detail.cgi?type=<x>`` values named in LakeFinder's own page and scripts, in order of first appearance."""
    out: list[str] = []
    for t in page_texts:
        for m in re.finditer(r"detail\.cgi\?[^\"'\s<>]*?\btype=([A-Za-z0-9_]+)", t):
            if m.group(1) not in out:
                out.append(m.group(1))
        for m in re.finditer(r"""["']?type["']?\s*[:=]\s*["']([a-z][a-z0-9_]*)["']""", t):
            # e.g. {type: 'fish_stocking'} next to a detail.cgi call
            window = t[max(0, m.start() - 300) : m.end() + 300]
            if "detail" in window and m.group(1) not in out:
                out.append(m.group(1))
    return out


def script_srcs(page_html: str) -> list[str]:
    return [m.group(1) for m in re.finditer(r"<script[^>]+src\s*=\s*[\"']([^\"']+)[\"']", page_html, re.I)]


# ------------------------------------------------------------------ stocking (verify)


def _species_code(v: Any) -> str:
    s = js_str(v)
    if re.fullmatch(r"[A-Za-z]{3}", s) and s.upper() in SPECIES:
        return s.upper()
    return code_for_name(s) or (s.upper() if re.fullmatch(r"[A-Z]{3}", s) else "")


def parse_stocking(data: Any) -> tuple[list[Obj], list[str]]:
    """Stocking rows ``{year, species, count, size}`` from any list of objects with a year and a species; plus problems."""
    rows: list[Obj] = []
    problems: list[str] = []

    def walk(v: Any, depth: int) -> None:
        if depth > 6:
            return
        if isinstance(v, list):
            for x in v:
                walk(x, depth + 1)
            return
        if not isinstance(v, dict):
            return
        year = num(get(v, "year", "stockingYear", "yr", "surveyYear"))
        sp_raw = get(v, "species", "speciesCode", "speciesName", "fish")
        if year is not None and sp_raw is not None and not isinstance(sp_raw, (dict, list)):
            code = _species_code(sp_raw)
            if not code:
                problems.append(f"unknown species {js_str(sp_raw)!r}")
                return
            count = num(get(v, "number", "count", "quantity", "numberStocked", "totalNumber", "fishStocked"))
            rows.append({"year": int(year), "species": code, "count": None if count is None else int(count), "size": js_str(get(v, "size", "sizeClass", "lifeStage", "stage", "age"))})
            return
        for x in v.values():
            walk(x, depth + 1)

    walk(data, 0)
    return rows, problems


# ------------------------------------------------------------------ special regulations (verify; verbatim)


def clean_text(s: str) -> str:
    """Markup removed, entities decoded, whitespace collapsed. Words and numbers are never changed."""
    s = re.sub(r"<br\s*/?>|</p>|</li>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_regs(data: Any) -> list[Obj]:
    """Regulation texts ``{species, text}`` (verbatim) from objects with a regulation-ish text field."""
    out: list[Obj] = []
    seen: set[tuple[str | None, str]] = set()

    def walk(v: Any, depth: int, species: str | None) -> None:
        if depth > 8:
            return
        if isinstance(v, list):
            for x in v:
                walk(x, depth + 1, species)
            return
        if not isinstance(v, dict):
            return
        sp_raw = get(v, "species", "speciesCode", "speciesName", "fish")
        sp = (_species_code(sp_raw) or None) if sp_raw is not None and not isinstance(sp_raw, (dict, list)) else species
        for k, x in v.items():
            if isinstance(x, str) and re.search(r"reg|text|desc|rule|limit", norm(k)) and not re.search(r"url|link|href|date|id$|type$", norm(k)):
                t = clean_text(x)
                if len(t) >= 10 and (sp, t) not in seen:
                    seen.add((sp, t))
                    out.append({"species": sp, "text": t})
            elif isinstance(x, (dict, list)):
                walk(x, depth + 1, sp)

    walk(data, 0, None)
    return out
