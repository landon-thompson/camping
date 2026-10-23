"""Launch parsing (waterAccess.ts / arcgis.ts rules), ramp classes, and OpenStreetMap lakes (osm.ts rules)."""

import math

import pytest

from lakerecs.parse_arcgis import dow_in, feature_point, order_services, parse_launch_features, pick, point_layer, query_url, ramp_class, ramp_layer, service_error, NAME, RAMP, WATER
from lakerecs.parse_osm import element_area_acres, nearest_water, overpass_query, parse_overpass


@pytest.mark.parametrize(
    "text,cls",
    [
        ("Concrete", "concrete"),
        ("CONCRETE PLANK", "concrete"),
        ("Bituminous", "concrete"),
        ("asphalt", "concrete"),
        ("wood", "concrete"),
        ("Gravel", "gravel"),
        ("Natural", "gravel"),
        ("dirt", "gravel"),
        ("sand", "gravel"),
        ("Carry-in", "carry-in"),
        ("Carry-In Only", "carry-in"),
        ("Canoe / kayak access", "carry-in"),
        ("walk-in", "carry-in"),
        ("", "unknown"),
        ("   ", "unknown"),
        ("access: private", "unknown"),
        ("Yes", "unknown"),
        ("Information unavailable", "unknown"),
    ],
)
def test_ramp_class(text, cls):
    assert ramp_class(text) == cls


def test_attribute_picking_like_the_app():
    a = {"OBJECTID": 1, "COUNTY_NAME": "Fixture", "ACCESS_NAME": "Fixture Access", "LAKE_NAME": "Fixture Lake", "DOW_NUM": "99-0103-00", "RAMP_TYPE": "Concrete", "UNIT_NAME": "x"}
    assert pick(a, NAME) == "Fixture Access"
    assert pick(a, WATER) == "Fixture Lake"
    assert pick(a, RAMP) == "Concrete"
    assert dow_in(a) == "99010300"
    assert dow_in({"BASIN_ID": 990103}) == "99010300"
    assert dow_in({"DOWLKNUM": None, "name": "x"}) is None
    assert pick({"NAME": "  ", "SITE_NAME": 5.0}, NAME) == "5"


def test_feature_points_and_launch_dedupe():
    assert feature_point({"geometry": {"x": -94.1, "y": 47.2}}) == (47.2, -94.1)
    assert feature_point({"attributes": {"LATITUDE": "47.2", "LONGITUDE": "-94.1"}}) == (47.2, -94.1)
    assert feature_point({"attributes": {"LAT": 0, "LON": 0}}) is None
    assert feature_point({"geometry": None, "attributes": {}}) is None
    feats = [
        {"attributes": {"ACCESS_NAME": "A", "LAKE_NAME": "L", "DOW": "99010300", "RAMP": "Gravel"}, "geometry": {"x": -94.0, "y": 47.0}},
        {"attributes": {"ACCESS_NAME": "A", "LAKE_NAME": "L", "DOW": "99010300", "RAMP": "Gravel"}, "geometry": {"x": -94.00001, "y": 47.00001}},  # same at 4 decimals
        {"attributes": {"LAKE_NAME": "L"}, "geometry": {"x": -94.2, "y": 47.1}},
        {"attributes": {"ACCESS_NAME": "no point"}},
    ]
    got = parse_launch_features(feats)
    assert [(x["name"], x["dow"], x["ramp"]) for x in got] == [("A", "99010300", "Gravel"), ("Public water access", None, "")]
    assert parse_launch_features(feats[:1], mn_lake_ids=False)[0]["dow"] is None


def test_layer_and_service_discovery():
    layers = [{"id": 0, "name": "Boundaries", "geometryType": "esriGeometryPolygon"}, {"id": 1, "name": "Sites", "geometryType": "esriGeometryPoint"}, {"id": 2, "name": "Water Access Sites", "geometryType": "esriGeometryPoint"}]
    assert point_layer(layers)["id"] == 2
    assert point_layer(layers[:2])["id"] == 1
    assert point_layer([]) is None
    svcs = [{"name": "Parks/Campgrounds", "type": "MapServer"}, {"name": "Parks/Boat_Ramps", "type": "FeatureServer"}, {"name": "Parks/Geocoder", "type": "GeocodeServer"}]
    assert [s["name"] for s in order_services(svcs)] == ["Parks/Boat_Ramps", "Parks/Campgrounds"]
    assert ramp_layer([{"id": 3, "name": "Boat Ramps", "geometryType": "esriGeometryPoint"}])["id"] == 3
    assert ramp_layer([{"id": 3, "name": "Boat Ramps", "geometryType": "esriGeometryPolygon"}]) is None
    assert service_error({"error": {"code": 400, "message": "Invalid query"}}) == "service error 400 Invalid query"
    assert service_error({"features": []}) is None


def test_query_url_is_stable_and_paginated():
    u = query_url("https://x.invalid/FeatureServer/0", offset=2000, count=1000, bbox=(-94.6, 46.9, -93.4, 47.6), order_by="OBJECTID")
    assert u == (
        "https://x.invalid/FeatureServer/0/query?where=1%3D1&outFields=%2A&returnGeometry=true&outSR=4326&resultOffset=2000&resultRecordCount=1000&f=json"
        "&orderByFields=OBJECTID&geometry=-94.60000%2C46.90000%2C-93.40000%2C47.60000&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"
    )
    assert "geometry=" not in query_url("https://x.invalid/0")


# ------------------------------------------------------------------ OSM


def square(lat, lng, side_km):
    d_lat = side_km / 110.54
    d_lng = side_km / (111.32 * math.cos(math.radians(lat)))
    pts = [(lat, lng), (lat, lng + d_lng), (lat + d_lat, lng + d_lng), (lat + d_lat, lng), (lat, lng)]
    return [{"lat": a, "lon": b} for a, b in pts]


def test_overpass_query_shape():
    q = overpass_query((-98.0, 44.0, -97.0, 45.0))
    assert q.startswith("[out:json][timeout:90];")
    assert '(way["natural"="water"]["name"](44.0000,-98.0000,45.0000,-97.0000);relation["natural"="water"]["name"](44.0000,-98.0000,45.0000,-97.0000););out tags geom;' in q
    assert q.endswith("out center tags;")


def test_areas_from_outlines():
    one_km2 = 1e6 / 4046.8564224
    assert element_area_acres({"type": "way", "geometry": square(44.0, -97.0, 1.0)}) == pytest.approx(one_km2, rel=0.01)
    assert element_area_acres({"type": "way", "geometry": square(44.0, -97.0, 1.0)[:-1]}) is None  # not closed
    outer = square(44.0, -97.0, 2.0)
    rel = {
        "type": "relation",
        "members": [
            {"type": "way", "role": "outer", "geometry": outer[:3]},
            {"type": "way", "role": "outer", "geometry": outer[2:][::-1]},  # reversed: still joins
            {"type": "way", "role": "inner", "geometry": square(44.005, -96.99, 1.0)},
            {"type": "node", "role": "label"},
        ],
    }
    assert element_area_acres(rel) == pytest.approx(3 * one_km2, rel=0.01)
    assert element_area_acres({"type": "relation", "members": [{"type": "way", "role": "outer", "geometry": outer[:3]}]}) is None


def test_parse_overpass_lakes_and_slipways():
    data = {
        "elements": [
            {"type": "way", "id": 1, "geometry": square(44.0, -97.0, 1.0), "tags": {"natural": "water", "water": "lake", "name": " Fixture Lake One "}},
            {"type": "way", "id": 2, "geometry": square(44.1, -97.0, 1.0), "tags": {"natural": "water", "water": "river", "name": "Fixture River"}},
            {"type": "way", "id": 3, "geometry": square(44.2, -97.0, 1.0), "tags": {"natural": "water"}},
            {"type": "way", "id": 1, "geometry": square(44.0, -97.0, 1.0), "tags": {"natural": "water", "name": "Fixture Lake One"}},  # repeated in another tile
            {"type": "node", "id": 10, "lat": 44.0, "lon": -97.003, "tags": {"leisure": "slipway", "surface": "concrete", "access": "customers"}},
            {"type": "way", "id": 11, "center": {"lat": 44.5, "lon": -97.0}, "tags": {"leisure": "slipway", "access": "yes"}},
        ]
    }
    waters, slips = parse_overpass(data)
    assert [(w["osm_id"], w["name"]) for w in waters] == [("way/1", "Fixture Lake One")]
    assert waters[0]["bounds"][0] == pytest.approx(44.0)
    assert [(s["osm_id"], s["ramp"]) for s in slips] == [("node/10", "concrete, access: customers"), ("way/11", "")]
    assert nearest_water((44.0, -97.003), waters)["osm_id"] == "way/1"  # 240 m outside the box
    assert nearest_water((44.5, -97.0), waters) is None
