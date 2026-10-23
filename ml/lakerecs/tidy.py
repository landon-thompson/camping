"""Collected records -> tidy tables (docs/LAKE_RECS_PLAN.md section 2, ``schema.py``).

Never invents values: a field the sources don't give stays null, and every
row dropped is counted in ``gaps.json``.
"""

from __future__ import annotations

import logging
import math
import re
from datetime import date
from typing import Any

from . import schema
from . import sources as S
from .fetch import Collected, Gaps
from .http import Client
from .parse_arcgis import ramp_class
from .parse_gfp import sd_slug, survey_type, water_name_variants
from .parse_lakefinder import format_dow, gear_family, lake_features, survey_lengths
from .parse_osm import distance_km, nearest_water
from .species import code_for_name

log = logging.getLogger(__name__)

SPECIES_CODE = re.compile(schema.SPECIES_RE)


def region_cell(state: str, lat: float | None, lng: float | None) -> str:
    """Coarse 1° cell used as a region when no official region is known."""
    if lat is None or lng is None:
        return f"{state}:cell:unknown"
    return f"{state}:cell:{math.floor(lat)}_{math.floor(lng)}"


def _name_key(name: str) -> str:
    n = re.sub(r"\(.*?\)", " ", name.lower())
    n = re.sub(r"\b(lake|lk|reservoir|res)\b", " ", n)
    return re.sub(r"[^a-z0-9]+", "", n)


# ------------------------------------------------------------------ MN


def _mn_lake_rows(col: Collected, gaps: Gaps) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for dow, lk in col.mn_lakes.items():
        e = col.mn_surveys.get(dow)
        f = lake_features(e["parsed"]["_result"]) if e else {}
        lat, lng = lk.get("lat"), lk.get("lng")
        if lat is None and f.get("lat") is not None:
            lat, lng = f["lat"], f["lng"]
        region = f"MN:{f['region']}" if f.get("region") else region_cell("MN", lat, lng)
        rows[dow] = {
            "lake_key": f"mn:{dow}",
            "state": "MN",
            "name": lk["name"],
            "county": lk.get("county") or f.get("county") or None,
            "lat": lat,
            "lng": lng,
            "area_acres": f.get("area_acres"),
            "max_depth_ft": f.get("max_depth_ft"),
            "clarity_ft": f.get("clarity_ft"),
            "region": region,
            "source_url": S.lf_page_url(dow),
            "parent_key": f"mn:{lk['parent']}" if lk.get("parent") else None,
        }
    # Whole lakes whose survey stands in for a sub-basin but weren't in the lake list themselves.
    for asked, for_dow in col.mn_survey_for.items():
        if for_dow in rows:
            continue
        e = col.mn_surveys[for_dow]
        f = lake_features(e["parsed"]["_result"])
        rows[for_dow] = {
            "lake_key": f"mn:{for_dow}",
            "state": "MN",
            "name": e["parsed"]["lakeName"],
            "county": f.get("county") or None,
            "lat": f.get("lat"),
            "lng": f.get("lng"),
            "area_acres": f.get("area_acres"),
            "max_depth_ft": f.get("max_depth_ft"),
            "clarity_ft": f.get("clarity_ft"),
            "region": f"MN:{f['region']}" if f.get("region") else region_cell("MN", f.get("lat"), f.get("lng")),
            "source_url": S.lf_page_url(for_dow),
            "parent_key": None,
        }
    for r in rows.values():
        if r["parent_key"] and r["parent_key"][3:] not in rows:
            r["parent_key"] = None
    return list(rows.values())


def _effort(family: str, gear_count: float | None, total: float | None, cpue: float | None, gaps: Gaps, where: str) -> tuple[float | None, str | None]:
    """Denominator of the published CPUE: nets for nets, hours for electrofishing (totalCatch / CPUE)."""
    derived = round(total / cpue, 3) if total and cpue and cpue > 0 else None
    if family == "electro":
        return (derived, "catch/cpue") if derived else (None, None)
    if gear_count and gear_count > 0:
        if derived and abs(derived - gear_count) > max(0.15 * gear_count, 0.5):
            gaps.add(S.SRC_LF, "effort-mismatch", f"{where}: gearCount {gear_count:g} vs totalCatch/CPUE {derived:g}")
        return gear_count, "gear_count"
    if derived:
        return derived, "catch/cpue"
    return None, None


def _mn_survey_rows(col: Collected, gaps: Gaps) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    used = sorted(set(col.mn_survey_for.values()))
    for dow in used:
        e = col.mn_surveys[dow]
        key = f"mn:{dow}"
        for s in e["parsed"]["surveys"]:
            if not s["catches"]:
                continue
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s["date"]):
                gaps.add(S.SRC_LF, "survey-without-date", f"{format_dow(dow)}: {s['date']!r}")
                continue
            sid = f"{s['date']}|{s['type']}"
            lens = survey_lengths(s["_raw"])
            rows: list[dict[str, Any]] = []
            for c in s["catches"]:
                where = f"{format_dow(dow)} {s['date']} {c['species']} {c['gear']}"
                if not SPECIES_CODE.fullmatch(c["species"]):
                    gaps.add(S.SRC_LF, "unusual-species-code", where)
                    continue
                if c["cpue"] is None and c["totalCatch"] is None:
                    gaps.add(S.SRC_LF, "row-without-numbers", where)
                    continue
                fam = gear_family(c["gear"])
                effort, how = _effort(fam, c["gearCount"], c["totalCatch"], c["cpue"], gaps, where)
                rows.append(
                    {
                        "lake_key": key,
                        "state": "MN",
                        "species": c["species"],
                        "survey_id": sid,
                        "survey_date": date.fromisoformat(s["date"]),
                        "survey_year": int(s["date"][:4]),
                        "survey_type": s["type"],
                        "gear": c["gear"],
                        "gear_family": fam,
                        "effort": effort,
                        "gear_count": c["gearCount"],
                        "effort_source": how,
                        "total_catch": None if c["totalCatch"] is None else int(round(c["totalCatch"])),
                        "cpue": c["cpue"],
                        "normal_low": c["normalLow"],
                        "normal_high": c["normalHigh"],
                        "avg_weight_lb": c["avgWeightLb"],
                        "normal_weight_low": c["normalWeightLow"],
                        "normal_weight_high": c["normalWeightHigh"],
                        "lengths": None,
                        "source_url": S.lf_page_url(dow),
                        "parse_source": "lakefinder-json",
                    }
                )
            # Electrofishing rows with no fish (CPUE 0) share the survey's hours with the rows that have fish.
            for r in rows:
                if r["effort"] is None and r["gear_family"] == "electro":
                    hours = sorted(x["effort"] for x in rows if x["gear"] == r["gear"] and x["effort"] is not None)
                    if hours and hours[-1] - hours[0] <= 0.05 * hours[-1]:
                        r["effort"], r["effort_source"] = hours[len(hours) // 2], "catch/cpue"
                if r["effort"] is None:
                    gaps.add(S.SRC_LF, "row-without-effort", f"{format_dow(dow)} {s['date']} {r['species']} {r['gear']}")
            for (sp, gear), pairs in lens.items():
                cands = [r for r in rows if r["species"] == sp and (not gear or r["gear"].lower() == gear.lower())]
                if not cands:
                    gaps.add(S.SRC_LF, "lengths-without-catch-row", f"{format_dow(dow)} {s['date']} {sp}")
                    continue
                if not gear:
                    gaps.add(S.SRC_LF, "lengths-not-gear-specific", f"{format_dow(dow)} {s['date']} {sp}")
                target = max(cands, key=lambda r: r["total_catch"] or 0)
                target["lengths"] = [{"inch": i, "count": n} for i, n in pairs]
            out += rows
    return out


def _mn_launch_rows(col: Collected, lakes: list[dict[str, Any]], gaps: Gaps) -> list[dict[str, Any]]:
    by_dow = {r["lake_key"][3:]: r for r in lakes if r["state"] == "MN"}
    by_name: dict[str, list[dict[str, Any]]] = {}
    for r in by_dow.values():
        by_name.setdefault(_name_key(r["name"]), []).append(r)
    out = []
    for lf in col.mn_launches:
        lake = None
        if lf["dow"]:
            lake = by_dow.get(lf["dow"]) or by_dow.get(f"{lf['dow'][:6]}00")
        if lake is None and lf["water"]:
            cands = [r for r in by_name.get(_name_key(lf["water"]), []) if r["lat"] is not None]
            near = sorted((distance_km((lf["lat"], lf["lng"]), (r["lat"], r["lng"])), r["lake_key"], r) for r in cands)
            if near and near[0][0] <= 15:
                lake = near[0][2]
        if lake is None:
            gaps.add(S.SRC_MN_ACCESS, "launch-not-matched-to-lake", f"{lf['name']} ({lf['water'] or 'no water name'})")
            continue
        out.append({"lake_key": lake["lake_key"], "name": lf["name"], "lat": lf["lat"], "lng": lf["lng"], "ramp": lf["ramp"], "ramp_class": ramp_class(lf["ramp"]), "source": lf["source"]})
    return out


def _mn_stocking_regs(col: Collected, keys: set[str], gaps: Gaps) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    stocking, regs = [], {}
    for dow, st in sorted(col.mn_stocking.items()):
        if f"mn:{dow}" not in keys:
            continue
        for r in st["rows"]:
            if r["year"] < 1900:
                gaps.add(S.SRC_LF, "stocking-row-skipped", f"{format_dow(dow)}: year {r['year']}")
                continue
            stocking.append({"lake_key": f"mn:{dow}", "year": r["year"], "species": r["species"], "count": r["count"], "size": r["size"], "source_url": S.lf_page_url(dow)})
    for dow, rg in sorted(col.mn_regs.items()):
        if f"mn:{dow}" not in keys:
            continue
        regs[f"mn:{dow}"] = [{"species": it["species"], "text": it["text"], "url": S.lf_page_url(dow), "fetchedAt": rg["fetched_at"]} for it in rg["items"]]
    return stocking, regs


# ------------------------------------------------------------------ SD


def _sd_lake_rows(col: Collected) -> list[dict[str, Any]]:
    out = []
    for slug, w in col.sd_waters.items():
        rep = col.sd_reports.get(slug)
        out.append(
            {
                "lake_key": f"sd:{slug}",
                "state": "SD",
                "name": w["name"],
                "county": None,
                "lat": round(w["lat"], 6),
                "lng": round(w["lng"], 6),
                "area_acres": w["area_acres"] if w["area_acres"] and w["area_acres"] > 0 else None,
                "max_depth_ft": None,
                "clarity_ft": None,
                "region": region_cell("SD", w["lat"], w["lng"]),
                "source_url": rep["list_url"] if rep else f"https://www.openstreetmap.org/{w['osm_id']}",
                "parent_key": None,
            }
        )
    return out


def _sd_survey_rows(col: Collected, gaps: Gaps) -> list[dict[str, Any]]:
    out = []
    for slug, rep in sorted(col.sd_reports.items()):
        name = col.sd_waters[slug]["name"]
        for r in rep["reports"]:
            sv = r["survey"]
            if sv is None:
                continue
            year = sv.year or r["link_year"]
            if year is None:
                gaps.add(S.SRC_GFP_REPORTS, "survey-without-year", f"{name} #{r['id']}")
                continue
            if not sv.catches:
                gaps.add(S.SRC_GFP_REPORTS, "pdf-no-catch-rows", f"{name} #{r['id']}")
                continue
            for c in sv.catches:
                code = code_for_name(c.species)
                if not code:
                    gaps.add(S.SRC_GFP_REPORTS, "species-without-dnr-code", c.species)
                    continue
                out.append(
                    {
                        "lake_key": f"sd:{slug}",
                        "state": "SD",
                        "species": code,
                        "survey_id": r["id"],
                        "survey_date": sv.date if sv.date and sv.date.year == year else None,
                        "survey_year": year,
                        "survey_type": survey_type(sv.title),
                        "gear": c.gear,
                        "gear_family": gear_family(c.gear),
                        "effort": None,
                        "gear_count": None,
                        "effort_source": None,
                        "total_catch": None,
                        "cpue": c.cpue,
                        "normal_low": None,
                        "normal_high": None,
                        "avg_weight_lb": None,
                        "normal_weight_low": None,
                        "normal_weight_high": None,
                        "lengths": None,
                        "source_url": r["url"],
                        "parse_source": "gfp-table" if c.source == "table" else "gfp-summary",
                    }
                )
    return out


def _sd_launch_rows(col: Collected, gaps: Gaps) -> list[dict[str, Any]]:
    waters = [{**w, "slug": s} for s, w in col.sd_waters.items()]
    out = []
    official: list[tuple[float, float]] = []
    for lf in col.sd_launches:
        hit = None
        if lf["water"]:
            want = {sd_slug(v) for v in water_name_variants(lf["water"])}
            named = [w for w in waters if w["slug"] in want or {sd_slug(v) for v in water_name_variants(w["name"])} & want]
            if named:
                hit = min(named, key=lambda w: distance_km((lf["lat"], lf["lng"]), (w["lat"], w["lng"])))
        hit = hit or nearest_water((lf["lat"], lf["lng"]), waters)
        if hit is None:
            gaps.add(S.SRC_GFP_GIS, "launch-not-matched-to-lake", f"{lf['name']} ({lf['water'] or 'no water name'})")
            continue
        official.append((lf["lat"], lf["lng"]))
        out.append({"lake_key": f"sd:{hit['slug']}", "name": lf["name"], "lat": lf["lat"], "lng": lf["lng"], "ramp": lf["ramp"], "ramp_class": ramp_class(lf["ramp"]), "source": lf["source"]})
    for sw in col.sd_slipways:
        p = (sw["lat"], sw["lng"])
        hit = nearest_water(p, waters)
        if hit is None:
            gaps.add(S.SRC_OSM, "slipway-not-near-a-kept-lake", sw["name"] or sw["osm_id"])
            continue
        if any(distance_km(p, o) < 0.1 for o in official):
            continue  # GFP's own record of the same ramp wins
        out.append(
            {
                "lake_key": f"sd:{hit['slug']}",
                "name": sw["name"] or f"{hit['name']} boat ramp",
                "lat": p[0],
                "lng": p[1],
                "ramp": sw["ramp"],
                "ramp_class": ramp_class(sw["ramp"]),
                "source": S.OSM_LABEL,
            }
        )
    return out


# ------------------------------------------------------------------ assembly


def _dedupe(rows: list[dict[str, Any]], key: tuple[str, ...], gaps: Gaps, source_of, kind: str) -> list[dict[str, Any]]:
    seen: set[tuple] = set()
    out = []
    for r in rows:
        k = tuple(r[c] for c in key)
        if k in seen:
            gaps.add(source_of(r), kind, " / ".join(map(str, k)))
            continue
        seen.add(k)
        out.append(r)
    return out


def _summary(col: Collected, tables: dict[str, Any], gaps: Gaps) -> list[str]:
    out: list[str] = []
    lakes = tables["lakes"]
    surveys = tables["surveys"]
    for st in ("MN", "SD"):
        n = int((lakes["state"] == st).sum())
        if not n:
            continue
        with_s = surveys.loc[surveys["state"] == st, "lake_key"].nunique()
        out.append(f"{st}: {n - with_s} of {n} lakes have no usable survey")
        no_pt = int(((lakes["state"] == st) & lakes["lat"].isna()).sum())
        if no_pt:
            out.append(f"{st}: {no_pt} lakes have no position")
    if len(surveys):
        sd = surveys[surveys["state"] == "SD"]
        if len(sd):
            out.append(f"SD: {int((sd['parse_source'] == 'gfp-summary').sum())} of {len(sd)} survey rows come from report summary sentences, not tables")
    labels = {
        (S.SRC_GFP_REPORTS, "pdf-unreadable"): "SD: {n} survey PDFs could not be read",
        (S.SRC_GFP_REPORTS, "no-survey-reports"): "SD: {n} lakes have no GFP survey report",
        (S.SRC_LF, "survey-unparseable"): "MN: {n} LakeFinder survey answers could not be parsed",
        (S.SRC_LF, "stocking-type-not-found"): "MN: stocking data not found on LakeFinder (skipped)",
        (S.SRC_LF, "regs-type-not-found"): "MN: special regulations not found on LakeFinder (skipped; statewide rules apply)",
        (S.SRC_GFP_GIS, "no-ramp-layer"): "SD: no GFP boat ramp layer found; OpenStreetMap ramps only",
        (S.SRC_MN_ACCESS, "launch-not-matched-to-lake"): "MN: {n} water accesses not matched to a listed lake",
    }
    for (src, kind), text in labels.items():
        n = gaps.count(src, kind)
        if n:
            out.append(text.format(n=n))
    misses = sum(v.get("not-in-cache", {}).get("count", 0) for v in gaps.data.values())
    if misses:
        out.append(f"{misses} requests were not in the cache (run fetch first)")
    return out


def build_tables(col: Collected, gaps: Gaps, client: Client | None = None) -> dict[str, Any]:
    lakes = _mn_lake_rows(col, gaps) + _sd_lake_rows(col)
    surveys = _mn_survey_rows(col, gaps) + _sd_survey_rows(col, gaps)
    # A lake without a point: use a launch on it when the launch layer names its DOW (as the app does).
    launches = _mn_launch_rows(col, lakes, gaps) + _sd_launch_rows(col, gaps)
    first_launch = {}
    for l in launches:
        first_launch.setdefault(l["lake_key"], l)
    for r in lakes:
        if r["lat"] is None and r["lake_key"] in first_launch:
            l = first_launch[r["lake_key"]]
            r["lat"], r["lng"] = l["lat"], l["lng"]
            if r["region"].endswith(":cell:unknown"):
                r["region"] = region_cell(r["state"], r["lat"], r["lng"])
            gaps.add(S.SRC_LF, "lake-point-from-launch", r["lake_key"])
        elif r["lat"] is None:
            gaps.add(S.SRC_LF if r["state"] == "MN" else S.SRC_OSM, "lake-without-position", r["lake_key"])
    keys = {r["lake_key"] for r in lakes}
    stocking, regs = _mn_stocking_regs(col, keys, gaps)

    src = lambda r: S.SRC_LF if r["state"] == "MN" else S.SRC_GFP_REPORTS  # noqa: E731
    surveys = _dedupe(surveys, schema.PRIMARY_KEYS["surveys"], gaps, src, "duplicate-survey-row")
    launches = _dedupe(launches, schema.PRIMARY_KEYS["launches"], gaps, lambda r: r["source"], "duplicate-launch")

    lakes.sort(key=lambda r: r["lake_key"])
    surveys.sort(key=lambda r: (r["lake_key"], r["species"], r["survey_year"], r["survey_id"], r["gear"]))
    launches.sort(key=lambda r: (r["lake_key"], r["name"], r["lat"], r["lng"]))
    stocking.sort(key=lambda r: (r["lake_key"], r["year"], r["species"], r["size"]))

    tables: dict[str, Any] = {
        "surveys": schema.frame_from_rows(surveys, "surveys"),
        "lakes": schema.frame_from_rows(lakes, "lakes"),
        "launches": schema.frame_from_rows(launches, "launches"),
        "stocking": schema.frame_from_rows(stocking, "stocking"),
        "regs": dict(sorted(regs.items())),
    }
    tables["gaps"] = {
        "bySource": {s: dict(sorted(k.items())) for s, k in sorted(gaps.data.items())},
        "summary": _summary(col, tables, gaps),
        "verify": list(S.VERIFY),
    }
    fetched = client.stats.fetched_at if client else {}
    tables["sources"] = [{"name": s["name"], "url": s["url"], "terms": s["terms"], "fetchedAt": fetched.get(s["key"])} for s in S.SOURCES if s["key"] in fetched]
    return tables
