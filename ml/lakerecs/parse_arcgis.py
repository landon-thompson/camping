"""ArcGIS REST helpers and boat-launch parsing, ported from
``src/features/places/arcgis.ts`` and ``waterAccess.ts``; plus the ramp
classification used by the model files (``TileLaunch.rampClass``).
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode

Attrs = dict[str, Any]

# Attribute-name patterns, in priority order (same as waterAccess.ts).
NAME = [re.compile(r"^(fac|facility|site|access|was)_?name$", re.I), re.compile(r"^name$", re.I), re.compile(r"^(?!.*(lake|water|county|admin|unit|owner|manag)).*name", re.I)]
WATER = [re.compile(r"^(lake|water|waterbody|water_body|resource)_?name$", re.I), re.compile(r"^(?!.*(id|num|dow|type|class)).*(lake|water|resource)", re.I)]
RAMP = [re.compile(r"ramp", re.I), re.compile(r"launch", re.I), re.compile(r"surface", re.I), re.compile(r"carry", re.I)]
MANAGER = [re.compile(r"admin", re.I), re.compile(r"manag", re.I), re.compile(r"owner", re.I), re.compile(r"agency", re.I), re.compile(r"unit_?type", re.I)]


def _js_string(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def pick(attrs: Attrs, patterns: list[re.Pattern[str]]) -> str:
    """First attribute whose name matches one of the patterns (in order) and has a value."""
    for rx in patterns:
        for k, v in attrs.items():
            if rx.search(k) and v is not None and _js_string(v).strip() != "":
                return _js_string(v).strip()
    return ""


def feature_point(f: dict[str, Any]) -> tuple[float, float] | None:
    """(lat, lng) of a feature: its geometry, or latitude/longitude attributes."""
    g = f.get("geometry") or {}
    x, y = g.get("x"), g.get("y")
    if isinstance(x, (int, float)) and isinstance(y, (int, float)) and abs(y) <= 90 and abs(x) <= 180:
        return (float(y), float(x))
    a = f.get("attributes") or {}
    try:
        lat = float(pick(a, [re.compile(r"^lat(itude)?$", re.I), re.compile(r"latitude", re.I), re.compile(r"_lat$", re.I)]) or "nan")
        lng = float(pick(a, [re.compile(r"^(lon|lng|long|longitude)$", re.I), re.compile(r"longitude", re.I), re.compile(r"_(lon|long)$", re.I)]) or "nan")
    except ValueError:
        return None
    if lat == lat and lng == lng and lat != 0 and lng != 0 and abs(lat) <= 90 and abs(lng) <= 180:
        return (lat, lng)
    return None


def dow_in(attrs: Attrs) -> str | None:
    for k, v in attrs.items():
        if not re.search(r"dow|lake_?id|lakeid|basin|wb_?id", k, re.I) or v is None:
            continue
        digits = re.sub(r"\D", "", _js_string(v))
        if len(digits) == 8:
            return digits
        if len(digits) == 6:
            return f"{digits}00"  # basin id without the sub-basin suffix
    return None


def parse_launch_features(features: list[dict[str, Any]], mn_lake_ids: bool = True) -> list[dict[str, Any]]:
    """Launch sites ``{name, water, dow, ramp, manager, lat, lng}`` (like ``parseLaunches``, without the distance filter)."""
    out = []
    seen: set[str] = set()
    for f in features:
        p = feature_point(f)
        if not p:
            continue
        a = f.get("attributes") or {}
        name = pick(a, NAME) or "Public water access"
        key = f"{name}|{p[0]:.4f}|{p[1]:.4f}"
        if key in seen:
            continue
        seen.add(key)
        out.append({"name": name, "water": pick(a, WATER), "dow": dow_in(a) if mn_lake_ids else None, "ramp": pick(a, RAMP), "manager": pick(a, MANAGER), "lat": p[0], "lng": p[1]})
    return out


def point_layer(layers: list[dict[str, Any]]) -> dict[str, Any] | None:
    for cond in (
        lambda x: re.search(r"point", x.get("geometryType") or "", re.I) and re.search(r"access|launch|was", x.get("name", ""), re.I),
        lambda x: re.search(r"point", x.get("geometryType") or "", re.I),
    ):
        hit = next((x for x in layers if cond(x)), None)
        if hit:
            return hit
    return layers[0] if layers else None


LIKELY_SERVICE = re.compile(r"ramp|access|boat|pwa|launch|fishing", re.I)


def order_services(services: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    """FeatureServer/MapServer services, likely boat-ramp ones first (as ``discoverSdAccessLayer``)."""
    svc = [s for s in services if re.fullmatch(r"FeatureServer|MapServer", s.get("type", ""))]
    return ([s for s in svc if LIKELY_SERVICE.search(s.get("name", ""))] + [s for s in svc if not LIKELY_SERVICE.search(s.get("name", ""))])[:limit]


def ramp_layer(layers: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((x for x in layers if re.search(r"ramp|water access|boat access|launch", x.get("name", ""), re.I) and re.search(r"point", x.get("geometryType") or "point", re.I)), None)


def query_url(layer_url: str, *, offset: int = 0, count: int = 1000, bbox: tuple[float, float, float, float] | None = None, where: str = "1=1", order_by: str | None = None) -> str:
    """A paginated ``query`` in lon/lat (``f=json``); parameter order is fixed so cache keys are stable."""
    p = {"where": where, "outFields": "*", "returnGeometry": "true", "outSR": "4326", "resultOffset": str(offset), "resultRecordCount": str(count), "f": "json"}
    if order_by:
        p["orderByFields"] = order_by
    if bbox:
        p.update({"geometry": ",".join(f"{v:.5f}" for v in bbox), "geometryType": "esriGeometryEnvelope", "inSR": "4326", "spatialRel": "esriSpatialRelIntersects"})
    return f"{layer_url}/query?{urlencode(p)}"


def service_error(data: Any) -> str | None:
    if isinstance(data, dict) and data.get("error"):
        e = data["error"]
        return f"service error {e.get('code', '')} {e.get('message', '')}".strip() if isinstance(e, dict) else str(e)
    return None


# ------------------------------------------------------------------ ramp classes

# Editable data: first rule that matches wins. "concrete" means any hard surface a trailer can use.
RAMP_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("carry-in", re.compile(r"carry|canoe|kayak|hand ?launch|walk[- ]?in|no ramp|portage", re.I)),
    ("concrete", re.compile(r"concrete|cement|plank|bitumin|asphalt|paved|hard ?surface|steel|metal|wood|timber|pre-?cast", re.I)),
    ("gravel", re.compile(r"gravel|natural|dirt|earth|sand|grass|ground|unpaved|soil|rock|compacted|stone", re.I)),
]


def ramp_class(text: str) -> str:
    """'Concrete' -> concrete, 'Gravel' -> gravel, 'Carry-in' -> carry-in, anything else -> unknown."""
    t = (text or "").strip()
    if not t:
        return "unknown"
    for cls, rx in RAMP_RULES:
        if rx.search(t):
            return cls
    return "unknown"
