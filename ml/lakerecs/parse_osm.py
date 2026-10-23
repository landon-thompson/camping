"""OpenStreetMap (Overpass) lakes and boat ramps for South Dakota.

Rules from ``src/features/places/osm.ts``: named ``natural=water`` ways and
relations, minus rivers/canals/etc. (``NOT_A_LAKE``); ``leisure=slipway``
ramps belong to the nearest named water within 600 m of its outline box.
Area is computed from the outline (closed rings; inner rings subtracted).
Data © OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import math
import re
from typing import Any

NOT_A_LAKE = re.compile(r"^(river|stream|canal|ditch|wastewater|lagoon|basin|moat|fish_pass|stream_pool)$")
M2_PER_ACRE = 4046.8564224


def overpass_query(box: tuple[float, float, float, float], timeout: int = 90) -> str:
    """Named waters (with outlines) and slipways in ``box`` = (west, south, east, north)."""
    w, s, e, n = box
    b = f"{s:.4f},{w:.4f},{n:.4f},{e:.4f}"
    return "".join(
        [
            f"[out:json][timeout:{timeout}];",
            f'(way["natural"="water"]["name"]({b});relation["natural"="water"]["name"]({b}););',
            "out tags geom;",
            f'(node["leisure"="slipway"]({b});way["leisure"="slipway"]({b}););',
            "out center tags;",
        ]
    )


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def distance_to_bounds(p: tuple[float, float], bounds: tuple[float, float, float, float] | None, center: tuple[float, float]) -> float:
    """0 inside the box (south, west, north, east), else km to its edge; like ``distanceToWater``."""
    if not bounds:
        return distance_km(p, center)
    s, w, n, e = bounds
    return distance_km(p, (min(max(p[0], s), n), min(max(p[1], w), e)))


def _ring_area_m2(ring: list[tuple[float, float]]) -> float:
    if len(ring) < 4:
        return 0.0
    lat0 = sum(p[0] for p in ring) / len(ring)
    kx = 111320.0 * math.cos(math.radians(lat0))
    ky = 110540.0
    pts = [(p[1] * kx, p[0] * ky) for p in ring]
    a = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def _coords(geom: Any) -> list[tuple[float, float]]:
    return [(float(g["lat"]), float(g["lon"])) for g in geom or [] if isinstance(g, dict) and "lat" in g and "lon" in g]


def _join_rings(parts: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]] | None:
    """Join open member ways into closed rings by matching end points; None if they don't close."""
    rings = [p for p in parts if len(p) >= 4 and p[0] == p[-1]]
    open_ = [list(p) for p in parts if not (len(p) >= 4 and p[0] == p[-1]) and len(p) >= 2]
    while open_:
        cur = open_.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, o in enumerate(open_):
                if o[0] == cur[-1]:
                    cur += o[1:]
                elif o[-1] == cur[-1]:
                    cur += o[::-1][1:]
                elif o[-1] == cur[0]:
                    cur = o + cur[1:]
                elif o[0] == cur[0]:
                    cur = o[::-1] + cur[1:]
                else:
                    continue
                open_.pop(i)
                changed = True
                break
        if cur[0] != cur[-1]:
            return None
        rings.append(cur)
    return rings


def element_area_acres(e: dict[str, Any]) -> float | None:
    """Area of a lake outline in acres, or None when the outline isn't closed / is missing."""
    if e.get("type") == "way":
        ring = _coords(e.get("geometry"))
        if len(ring) < 4 or ring[0] != ring[-1]:
            return None
        return round(_ring_area_m2(ring) / M2_PER_ACRE, 1)
    if e.get("type") == "relation":
        outer, inner = [], []
        for m in e.get("members") or []:
            if m.get("type") != "way":
                continue
            c = _coords(m.get("geometry"))
            (inner if m.get("role") == "inner" else outer).append(c)
        if not outer:
            return None
        o = _join_rings(outer)
        i = _join_rings(inner) if inner else []
        if o is None or i is None:
            return None
        area = sum(_ring_area_m2(r) for r in o) - sum(_ring_area_m2(r) for r in i)
        return round(area / M2_PER_ACRE, 1) if area > 0 else None
    return None


def _bounds(e: dict[str, Any]) -> tuple[float, float, float, float] | None:
    b = e.get("bounds")
    if isinstance(b, dict):
        return (b["minlat"], b["minlon"], b["maxlat"], b["maxlon"])
    pts = _coords(e.get("geometry"))
    for m in e.get("members") or []:
        pts += _coords(m.get("geometry"))
    if not pts:
        return None
    return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))


def parse_overpass(data: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(waters, slipways). waters: ``{osm_id, name, lat, lng, bounds, area_acres, water}``; slipways: ``{osm_id, name, ramp, operator, lat, lng}``."""
    elements = [e for e in (data or {}).get("elements", []) if isinstance(e, dict)]
    waters: list[dict[str, Any]] = []
    seen: set[str] = set()
    for e in elements:
        t = e.get("tags") or {}
        if t.get("natural") != "water" or not t.get("name") or NOT_A_LAKE.match(t.get("water", "")):
            continue
        oid = f"{e.get('type')}/{e.get('id')}"
        if oid in seen:
            continue
        b = _bounds(e)
        c = e.get("center")
        if c:
            center = (c["lat"], c["lon"])
        elif b:
            center = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
        elif e.get("lat") is not None and e.get("lon") is not None:
            center = (e["lat"], e["lon"])
        else:
            continue
        seen.add(oid)
        waters.append({"osm_id": oid, "name": t["name"].strip(), "lat": center[0], "lng": center[1], "bounds": b, "area_acres": element_area_acres(e), "water": t.get("water", "")})
    slipways: list[dict[str, Any]] = []
    for e in elements:
        t = e.get("tags") or {}
        if t.get("leisure") != "slipway":
            continue
        oid = f"{e.get('type')}/{e.get('id')}"
        if oid in seen:
            continue
        if e.get("center"):
            p = (e["center"]["lat"], e["center"]["lon"])
        elif e.get("lat") is not None and e.get("lon") is not None:
            p = (e["lat"], e["lon"])
        else:
            continue
        seen.add(oid)
        access = t.get("access", "")
        ramp = ", ".join(x for x in (t.get("surface", ""), f"access: {access}" if access and access != "yes" else "") if x)
        slipways.append({"osm_id": oid, "name": t.get("name", ""), "ramp": ramp, "operator": t.get("operator", ""), "lat": p[0], "lng": p[1]})
    return waters, slipways


def nearest_water(p: tuple[float, float], waters: list[dict[str, Any]], max_km: float = 0.6) -> dict[str, Any] | None:
    """The named water a ramp launches into: nearest outline box within 600 m (ramps sit a little off the shore)."""
    best, hit = max_km, None
    for w in waters:
        d = distance_to_bounds(p, w["bounds"], (w["lat"], w["lng"]))
        if d <= best:
            best, hit = d, w
    return hit
