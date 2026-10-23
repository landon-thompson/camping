"""Walk every source and collect parsed records.

The same walk serves both commands: ``fetch`` runs it with the network on
(warming ``ml/cache``), ``tidy`` runs it with an offline client, so the raw
cache is the single source of truth and a tidy run is reproducible. Anything
that fails or is missing is counted in ``Gaps`` (never guessed).
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode, urljoin, urlsplit

from . import sources as S
from .http import Client, HttpError, OfflineMiss, Response
from .parse_arcgis import order_services, parse_launch_features, point_layer, query_url, ramp_layer, service_error
from .parse_gfp import ReportLink, SdSurvey, parse_report_links, parse_survey, pdf_lines, sd_slug, survey_links, water_name_variants
from .parse_lakefinder import NoSurvey, discover_detail_types, format_dow, parse_json_loose, parse_lake_survey, parse_nearby_lakes, parse_regs, parse_stocking, script_srcs
from .parse_osm import overpass_query, parse_overpass

log = logging.getLogger(__name__)

Box = tuple[float, float, float, float]  # west, south, east, north


# ------------------------------------------------------------------ options and gaps


@dataclass
class Options:
    states: tuple[str, ...] = ("MN", "SD")
    bbox: Box | None = None
    limit: int | None = None
    grid_km: float = S.LF_GRID_KM
    lf_result_cap: int = S.LF_RESULT_CAP
    lf_stocking_type: str | None = None  # override discovery; "" = skip
    lf_regs_type: str | None = None
    sd_reports: int = 3  # newest GFP survey PDFs per lake
    sd_min_acres: float = 10.0  # SD waters smaller than this (from the OSM outline) are skipped
    state_bbox: dict[str, Box] | None = None  # per-state boxes used when ``bbox`` is None (fixtures)

    def box(self, state: str) -> Box | None:
        """The user's box for this state, if any (None = the whole state)."""
        if self.bbox is not None:
            return self.bbox
        return (self.state_bbox or {}).get(state)


class Gaps:
    """Counts and examples of everything missing or unparseable, by source and kind."""

    def __init__(self, max_examples: int = 5):
        self.max_examples = max_examples
        self.data: dict[str, dict[str, dict[str, Any]]] = {}

    def add(self, source: str, kind: str, example: str | None = None, n: int = 1) -> None:
        d = self.data.setdefault(source, {}).setdefault(kind, {"count": 0, "examples": []})
        d["count"] += n
        if example is not None and len(d["examples"]) < self.max_examples and example not in d["examples"]:
            d["examples"].append(example)

    def count(self, source: str, kind: str) -> int:
        return self.data.get(source, {}).get(kind, {}).get("count", 0)


# ------------------------------------------------------------------ collected records


@dataclass
class Collected:
    # MN
    mn_lakes: dict[str, dict[str, Any]] = field(default_factory=dict)  # dow -> by_point lake (+ "parent")
    mn_surveys: dict[str, dict[str, Any]] = field(default_factory=dict)  # dow the survey is FOR -> {parsed, url, fetched_at}
    mn_survey_for: dict[str, str] = field(default_factory=dict)  # requested dow -> dow whose survey applies
    mn_stocking: dict[str, dict[str, Any]] = field(default_factory=dict)  # dow -> {rows, url, fetched_at}
    mn_regs: dict[str, dict[str, Any]] = field(default_factory=dict)  # dow -> {items, url, fetched_at}
    mn_launches: list[dict[str, Any]] = field(default_factory=list)
    # SD
    sd_waters: dict[str, dict[str, Any]] = field(default_factory=dict)  # slug -> water
    sd_slipways: list[dict[str, Any]] = field(default_factory=list)
    sd_reports: dict[str, dict[str, Any]] = field(default_factory=dict)  # slug -> {list_url, reports: [...]}
    sd_launches: list[dict[str, Any]] = field(default_factory=list)


# ------------------------------------------------------------------ geometry helpers


def intersect(a: Box, b: Box | None) -> Box | None:
    if b is None:
        return a
    w, s, e, n = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    return (w, s, e, n) if w < e and s < n else None


def in_box(lat: float | None, lng: float | None, box: Box | None) -> bool:
    if box is None or lat is None or lng is None:
        return True
    return box[0] <= lng <= box[2] and box[1] <= lat <= box[3]


def grid_points(box: Box, spacing_km: float) -> list[tuple[float, float]]:
    """Cell centres of a grid with ``spacing_km`` cells covering ``box`` (rows south to north, west to east)."""
    w, s, e, n = box
    dlat = spacing_km / 111.0
    pts = []
    rows = max(1, math.ceil((n - s) / dlat))
    for i in range(rows):
        lat = s + (i + 0.5) * (n - s) / rows
        dlng = spacing_km / (111.0 * math.cos(math.radians(lat)))
        cols = max(1, math.ceil((e - w) / dlng))
        for j in range(cols):
            pts.append((round(lat, 5), round(w + (j + 0.5) * (e - w) / cols, 5)))
    return pts


def radius_m(spacing_km: float) -> float:
    """Radius whose circle covers a square cell (half diagonal) plus 1 km."""
    return (spacing_km / math.sqrt(2) + 1.0) * 1000


def tiles(box: Box, deg: float) -> list[Box]:
    """``box`` cut on a ``deg`` grid aligned to whole degrees."""
    w, s, e, n = box
    out = []
    lat = math.floor(s / deg) * deg
    while lat < n:
        lng = math.floor(w / deg) * deg
        while lng < e:
            t = intersect((lng, lat, lng + deg, lat + deg), box)
            if t:
                out.append(tuple(round(v, 5) for v in t))
            lng += deg
        lat += deg
    return out


# ------------------------------------------------------------------ small fetch helpers


def _json(resp: Response) -> Any:
    return parse_json_loose(resp.text())


def _try(gaps: Gaps, source: str, kind: str, example: str, fn, *a, **kw):
    """Run a fetch; on a network/HTTP failure count a gap and return None."""
    try:
        return fn(*a, **kw)
    except OfflineMiss:
        gaps.add(source, "not-in-cache", example)
    except HttpError as e:
        gaps.add(source, kind, f"{example}: {e}")
    return None


def get_lf_api(client: Client, url: str) -> Response:
    """LakeFinder API with the app's https -> http fallback (the DNR documents these APIs on http)."""
    first: Exception | None = None
    try:
        r = client.get(S.SRC_LF, url, max_age_days=S.MAX_AGE_DAYS["lake_list"])
        if r.ok:
            return r
    except HttpError as e:  # includes OfflineMiss: the http answer may be the cached one
        first = e
    try:
        return client.get(S.SRC_LF, url.replace("https:", "http:", 1), max_age_days=S.MAX_AGE_DAYS["lake_list"])
    except OfflineMiss:
        if first is not None:
            raise first
        raise


# ------------------------------------------------------------------ MN


def mn_enumerate(client: Client, opts: Options, gaps: Gaps, col: Collected) -> None:
    box = intersect(S.MN_BOX, opts.box("MN"))
    if box is None:
        return
    queue: list[tuple[float, float, float, int]] = [(lat, lng, opts.grid_km, 0) for lat, lng in grid_points(box, opts.grid_km)]
    done = 0
    while queue:
        if opts.limit and len(col.mn_lakes) >= opts.limit:
            break
        lat, lng, spacing, depth = queue.pop(0)
        url = S.lf_by_point_url(lat, lng, radius_m(spacing))
        r = _try(gaps, S.SRC_LF, "by-point-failed", f"{lat:.3f},{lng:.3f}", get_lf_api, client, url)
        done += 1
        if r is None:
            continue
        if not r.ok:
            gaps.add(S.SRC_LF, "by-point-failed", f"{lat:.3f},{lng:.3f}: HTTP {r.status}")
            continue
        try:
            lakes = parse_nearby_lakes(_json(r))
        except ValueError:
            gaps.add(S.SRC_LF, "by-point-unparseable", f"{lat:.3f},{lng:.3f}")
            continue
        if len(lakes) >= opts.lf_result_cap and depth < 3:
            half = spacing / 2
            dlat = half / 2 / 111.0
            dlng = half / 2 / (111.0 * math.cos(math.radians(lat)))
            queue[:0] = [(round(lat + a * dlat, 5), round(lng + b * dlng, 5), half, depth + 1) for a in (-1, 1) for b in (-1, 1)]
            gaps.add(S.SRC_LF, "by-point-capped-split", f"{lat:.3f},{lng:.3f}: {len(lakes)} lakes")
        for lk in lakes:
            if not in_box(lk["lat"], lk["lng"], opts.box("MN")):
                continue
            prev = col.mn_lakes.get(lk["dow"])
            if prev is None:
                col.mn_lakes[lk["dow"]] = {k: v for k, v in lk.items() if k != "_raw"}
            elif prev["lat"] is None and lk["lat"] is not None:
                prev["lat"], prev["lng"] = lk["lat"], lk["lng"]
        if done % 50 == 0:
            log.info("MN lake list: %d points, %d lakes", done, len(col.mn_lakes))
    if opts.limit and len(col.mn_lakes) > opts.limit:
        col.mn_lakes = dict(list(col.mn_lakes.items())[: opts.limit])
    log.info("MN lake list: %d lakes", len(col.mn_lakes))


def _fetch_survey(client: Client, dow: str, gaps: Gaps, col: Collected) -> dict[str, Any] | None:
    """One lake's survey JSON (cached in ``col``); None when there's none / it failed (gap counted)."""
    if dow in col.mn_surveys:
        return col.mn_surveys[dow]
    url = S.lf_survey_url(dow)
    r = _try(gaps, S.SRC_LF, "survey-http-error", format_dow(dow), client.get, S.SRC_LF, url, max_age_days=S.MAX_AGE_DAYS["survey"])
    if r is None:
        return None
    if not r.ok:
        gaps.add(S.SRC_LF, "survey-http-error", f"{format_dow(dow)}: HTTP {r.status}")
        return None
    try:
        data = _json(r)
    except ValueError:
        gaps.add(S.SRC_LF, "survey-unparseable", format_dow(dow))
        return None
    try:
        parsed = parse_lake_survey(data, dow)
    except NoSurvey as e:
        gaps.add(S.SRC_LF, "no-survey", f"{format_dow(dow)}: {e}")
        return None
    entry = {"parsed": parsed, "url": url, "fetched_at": r.fetched_at}
    col.mn_surveys[dow] = entry
    return entry


def mn_surveys(client: Client, opts: Options, gaps: Gaps, col: Collected) -> None:
    for i, dow in enumerate(sorted(col.mn_lakes)):
        e = _fetch_survey(client, dow, gaps, col)
        has_catch = bool(e and any(s["catches"] for s in e["parsed"]["surveys"]))
        if has_catch:
            col.mn_survey_for[dow] = dow
        elif not dow.endswith("00"):
            # A sub-basin with no net results of its own: the whole lake's survey applies (as the app does).
            parent = f"{dow[:6]}00"
            col.mn_lakes[dow]["parent"] = parent
            pe = _fetch_survey(client, parent, gaps, col)
            if pe and any(s["catches"] for s in pe["parsed"]["surveys"]):
                col.mn_survey_for[dow] = parent
                gaps.add(S.SRC_LF, "sub-basin-uses-whole-lake", f"{format_dow(dow)} -> {format_dow(parent)}")
        elif e:
            gaps.add(S.SRC_LF, "survey-without-catch", format_dow(dow))
        if (i + 1) % 100 == 0:
            log.info("MN surveys: %d / %d", i + 1, len(col.mn_lakes))


def mn_discover_types(client: Client, opts: Options, gaps: Gaps, col: Collected) -> dict[str, str | None]:
    """``type=`` values for stocking and regulations: CLI override, else found in LakeFinder's own page and scripts (verify)."""
    want = {"stocking": opts.lf_stocking_type, "regs": opts.lf_regs_type}
    if all(v is not None for v in want.values()) or not col.mn_lakes:
        return {k: (v or None) for k, v in want.items()}
    dow = sorted(col.mn_lakes)[0]
    page_url = S.lf_page_url(dow)
    texts: list[str] = []
    r = _try(gaps, S.SRC_LF, "lake-page-failed", page_url, client.get, S.SRC_LF, page_url, max_age_days=S.MAX_AGE_DAYS["lake_list"])
    if r is not None and r.ok:
        texts.append(r.text())
        host = urlsplit(page_url).netloc
        for src in script_srcs(r.text())[:8]:
            js_url = urljoin(page_url, src)
            if urlsplit(js_url).netloc != host:
                continue
            jr = _try(gaps, S.SRC_LF, "lake-page-failed", js_url, client.get, S.SRC_LF, js_url, max_age_days=S.MAX_AGE_DAYS["lake_list"])
            if jr is not None and jr.ok:
                texts.append(jr.text())
    found = [t for t in discover_detail_types(texts) if t != "lake_survey"]
    out: dict[str, str | None] = {}
    for kind, pattern in S.LF_TYPE_PATTERNS.items():
        if want[kind] is not None:
            out[kind] = want[kind] or None
            continue
        hit = next((t for t in found if re.search(pattern, t, re.I)), None)
        out[kind] = hit
        if hit is None:
            gaps.add(S.SRC_LF, f"{kind}-type-not-found", f"no detail.cgi type matching /{pattern}/ on {page_url} (found: {found or 'none'})")
    return out


def mn_details(client: Client, opts: Options, gaps: Gaps, col: Collected) -> None:
    types = mn_discover_types(client, opts, gaps, col)
    for dow in sorted(col.mn_lakes):
        if types.get("stocking"):
            url = S.lf_detail_url(types["stocking"], dow)
            r = _try(gaps, S.SRC_LF, "stocking-http-error", format_dow(dow), client.get, S.SRC_LF, url, max_age_days=S.MAX_AGE_DAYS["survey"])
            if r is not None and r.ok:
                try:
                    rows, problems = parse_stocking(_json(r))
                except ValueError:
                    gaps.add(S.SRC_LF, "stocking-unparseable", format_dow(dow))
                else:
                    for p in problems:
                        gaps.add(S.SRC_LF, "stocking-row-skipped", f"{format_dow(dow)}: {p}")
                    if rows:
                        col.mn_stocking[dow] = {"rows": rows, "url": url, "fetched_at": r.fetched_at}
        if types.get("regs"):
            url = S.lf_detail_url(types["regs"], dow)
            r = _try(gaps, S.SRC_LF, "regs-http-error", format_dow(dow), client.get, S.SRC_LF, url, max_age_days=S.MAX_AGE_DAYS["survey"])
            if r is not None and r.ok:
                try:
                    items = parse_regs(_json(r))
                except ValueError:
                    gaps.add(S.SRC_LF, "regs-unparseable", format_dow(dow))
                else:
                    if items:
                        col.mn_regs[dow] = {"items": items, "url": url, "fetched_at": r.fetched_at}


def arcgis_all(client: Client, source: str, layer_url: str, layer: dict[str, Any], box: Box | None, gaps: Gaps, max_age: float | None) -> list[dict[str, Any]] | None:
    """Every feature of a layer (optionally in a box), page by page."""
    page = min(S.ARCGIS_PAGE, int(layer.get("maxRecordCount") or S.ARCGIS_PAGE))
    oid = layer.get("objectIdField") or next((f["name"] for f in layer.get("fields") or [] if f.get("type") == "esriFieldTypeOID"), None)
    feats: list[dict[str, Any]] = []
    for i in range(500):
        url = query_url(layer_url, offset=i * page, count=page, bbox=box, order_by=oid)
        r = client.get(source, url, max_age_days=max_age)
        if not r.ok:
            gaps.add(source, "query-http-error", f"{layer_url}: HTTP {r.status}")
            return feats or None
        data = _json(r)
        err = service_error(data)
        if err:
            gaps.add(source, "query-service-error", f"{layer_url}: {err}")
            return feats or None
        batch = data.get("features") or []
        feats += batch
        if not batch or (not data.get("exceededTransferLimit") and len(batch) < page):
            break
    return feats


def _layers(client: Client, source: str, service: str, max_age: float | None) -> list[dict[str, Any]]:
    r = client.get(source, f"{service}/layers?f=json", max_age_days=max_age)
    if not r.ok:
        raise HttpError(r.url, r.status)
    data = _json(r)
    err = service_error(data)
    if err:
        raise HttpError(r.url, None, err)
    return data.get("layers") or []


def mn_launches(client: Client, opts: Options, gaps: Gaps, col: Collected) -> None:
    box = intersect(S.MN_BOX, opts.box("MN"))
    if box is None:
        return
    if opts.limit:  # only around the lakes we kept
        pts = [(lk["lat"], lk["lng"]) for lk in col.mn_lakes.values() if lk.get("lat") is not None]
        if not pts:
            return
        m = 0.1
        box = (min(p[1] for p in pts) - m, min(p[0] for p in pts) - m, max(p[1] for p in pts) + m, max(p[0] for p in pts) + m)
    elif opts.box("MN") is None:
        box = None  # whole layer
    for service, label in S.WATER_ACCESS_SERVICES:
        try:
            layer = point_layer(_layers(client, S.SRC_MN_ACCESS, service, S.MAX_AGE_DAYS["lake_list"]))
            if not layer:
                gaps.add(S.SRC_MN_ACCESS, "no-layers", label)
                continue
            feats = arcgis_all(client, S.SRC_MN_ACCESS, f"{service}/{layer['id']}", layer, box, gaps, S.MAX_AGE_DAYS["access"])
        except OfflineMiss:
            gaps.add(S.SRC_MN_ACCESS, "not-in-cache", label)
            continue
        except (HttpError, ValueError) as e:
            gaps.add(S.SRC_MN_ACCESS, "service-failed", f"{label}: {e}")
            continue
        if feats is None:
            continue
        for lf in parse_launch_features(feats, mn_lake_ids=True):
            col.mn_launches.append({**lf, "source": label})
        log.info("MN launches: %d from %s", len(col.mn_launches), label)
        return


# ------------------------------------------------------------------ SD


def sd_lakes(client: Client, opts: Options, gaps: Gaps, col: Collected) -> None:
    box = intersect(S.SD_BOX, opts.box("SD"))
    if box is None:
        return
    waters: dict[str, dict[str, Any]] = {}
    slipways: dict[str, dict[str, Any]] = {}
    for t in tiles(box, S.OSM_TILE_DEG):
        q = overpass_query(t)
        r = _try(gaps, S.SRC_OSM, "overpass-failed", ",".join(map(str, t)), client.post, S.SRC_OSM, S.OVERPASS_URL, urlencode({"data": q}), max_age_days=S.MAX_AGE_DAYS["lake_list"])
        if r is None:
            continue
        if not r.ok:
            gaps.add(S.SRC_OSM, "overpass-failed", f"{t}: HTTP {r.status}")
            continue
        try:
            ws, ss = parse_overpass(_json(r))
        except (ValueError, KeyError, TypeError):
            gaps.add(S.SRC_OSM, "overpass-unparseable", str(t))
            continue
        for w in ws:
            waters.setdefault(w["osm_id"], w)
        for s in ss:
            slipways.setdefault(s["osm_id"], s)
    by_slug: dict[str, dict[str, Any]] = {}
    for w in sorted(waters.values(), key=lambda w: (-(w["area_acres"] or 0), w["osm_id"])):
        if not (S.SD_BOX[1] <= w["lat"] <= S.SD_BOX[3] and S.SD_BOX[0] <= w["lng"] <= S.SD_EAST_LNG) or not in_box(w["lat"], w["lng"], opts.box("SD")):
            continue
        if w["area_acres"] is not None and w["area_acres"] < opts.sd_min_acres:
            gaps.add(S.SRC_OSM, "below-min-acres", f"{w['name']} ({w['area_acres']} acres)")
            continue
        if w["area_acres"] is None:
            gaps.add(S.SRC_OSM, "area-unknown", f"{w['name']} ({w['osm_id']})")
        slug = sd_slug(w["name"])
        if not slug:
            continue
        if slug in by_slug:
            gaps.add(S.SRC_OSM, "duplicate-name-kept-largest", f"{w['name']} ({w['osm_id']} dropped; kept {by_slug[slug]['osm_id']})")
            continue
        by_slug[slug] = w
    slugs = sorted(by_slug)
    if opts.limit:
        slugs = slugs[: opts.limit]
    col.sd_waters = {s: by_slug[s] for s in slugs}
    col.sd_slipways = sorted(slipways.values(), key=lambda s: s["osm_id"])
    log.info("SD lakes: %d (OSM), %d slipways", len(col.sd_waters), len(col.sd_slipways))


def _year_in(text: str) -> int | None:
    m = re.search(r"\b(19[89]\d|20\d{2})\b", text)
    return int(m.group(1)) if m else None


def sd_reports(client: Client, opts: Options, gaps: Gaps, col: Collected) -> None:
    for i, (slug, w) in enumerate(col.sd_waters.items()):
        found: list[ReportLink] = []
        list_url = ""
        for variant in water_name_variants(w["name"]):
            url = S.gfp_list_url(variant)
            r = _try(gaps, S.SRC_GFP_REPORTS, "list-http-error", variant, client.get, S.SRC_GFP_REPORTS, url, max_age_days=S.MAX_AGE_DAYS["gfp_list"])
            if r is None or not r.ok:
                continue
            links = survey_links(parse_report_links(r.text()[:3_000_000]))
            if links:
                found, list_url = links[: opts.sd_reports], url
                break
        if not found:
            gaps.add(S.SRC_GFP_REPORTS, "no-survey-reports", w["name"])
            continue
        reports = []
        for link in found:
            pdf_url = S.gfp_pdf_url(link.id)
            rep: dict[str, Any] = {"id": link.id, "text": link.text, "url": pdf_url, "survey": None, "link_year": _year_in(link.text)}
            r = _try(gaps, S.SRC_GFP_REPORTS, "pdf-http-error", f"{w['name']} #{link.id}", client.get, S.SRC_GFP_REPORTS, pdf_url, max_age_days=S.MAX_AGE_DAYS["pdf"])
            if r is not None and r.ok:
                try:
                    rep["survey"] = parse_survey(pdf_lines(r.content))
                    rep["fetched_at"] = r.fetched_at
                except Exception as e:  # pdfplumber raises many kinds on broken files
                    gaps.add(S.SRC_GFP_REPORTS, "pdf-unreadable", f"{w['name']} #{link.id}: {type(e).__name__}")
            elif r is not None:
                gaps.add(S.SRC_GFP_REPORTS, "pdf-http-error", f"{w['name']} #{link.id}: HTTP {r.status}")
            reports.append(rep)
        col.sd_reports[slug] = {"list_url": list_url, "reports": reports}
        if (i + 1) % 50 == 0:
            log.info("SD reports: %d / %d lakes", i + 1, len(col.sd_waters))


def sd_discover_layer(client: Client, gaps: Gaps) -> tuple[str, str, dict[str, Any]] | None:
    """GFP's boat ramp / water access point layer, found by name (verify): (url, label, layer)."""
    services: list[dict[str, Any]] = []
    for folder in S.SD_GFP_FOLDERS:
        url = f"{S.SD_GFP_SERVER}/{folder}?f=json"
        try:
            r = client.get(S.SRC_GFP_GIS, url, max_age_days=S.MAX_AGE_DAYS["lake_list"])
            if r.ok:
                services += _json(r).get("services") or []
        except OfflineMiss:
            gaps.add(S.SRC_GFP_GIS, "not-in-cache", url)
        except (HttpError, ValueError):
            pass  # folder not public: try the next
    for svc in order_services(services):
        base = f"{S.SD_GFP_SERVER}/{svc['name']}/{svc['type']}"
        try:
            layer = ramp_layer(_layers(client, S.SRC_GFP_GIS, base, S.MAX_AGE_DAYS["lake_list"]))
        except OfflineMiss:
            gaps.add(S.SRC_GFP_GIS, "not-in-cache", base)
            continue
        except (HttpError, ValueError):
            continue
        if layer:
            return f"{base}/{layer['id']}", f"{svc['name']} › {layer['name']}", layer
    return None


def sd_launches(client: Client, opts: Options, gaps: Gaps, col: Collected) -> None:
    box = intersect(S.SD_BOX, opts.box("SD"))
    if box is None or not col.sd_waters:
        return
    found = sd_discover_layer(client, gaps)
    if not found:
        gaps.add(S.SRC_GFP_GIS, "no-ramp-layer", "no boat ramp layer found on GFP's map server")
        return
    url, label, layer = found
    try:
        feats = arcgis_all(client, S.SRC_GFP_GIS, url, layer, box, gaps, S.MAX_AGE_DAYS["access"])
    except OfflineMiss:
        gaps.add(S.SRC_GFP_GIS, "not-in-cache", url)
        return
    except (HttpError, ValueError) as e:
        gaps.add(S.SRC_GFP_GIS, "query-failed", f"{label}: {e}")
        return
    for lf in parse_launch_features(feats or [], mn_lake_ids=False):
        col.sd_launches.append({**lf, "source": f"{S.SD_GFP_LABEL} ({label})"})
    log.info("SD launches: %d from %s", len(col.sd_launches), label)


# ------------------------------------------------------------------ everything


def collect(client: Client, opts: Options, gaps: Gaps) -> Collected:
    col = Collected()
    if "MN" in opts.states:
        mn_enumerate(client, opts, gaps, col)
        mn_surveys(client, opts, gaps, col)
        mn_details(client, opts, gaps, col)
        mn_launches(client, opts, gaps, col)
    if "SD" in opts.states:
        sd_lakes(client, opts, gaps, col)
        sd_reports(client, opts, gaps, col)
        sd_launches(client, opts, gaps, col)
    return col


__all__ = ["Options", "Gaps", "Collected", "collect", "grid_points", "radius_m", "tiles", "intersect", "SdSurvey"]
