"""Official/open data sources: URLs, cache folders, terms, and what still needs verifying.

URLs mirror the app (``src/features/fishing/lakeSurvey.ts``,
``src/features/places/waterAccess.ts``, ``src/features/places/osm.ts``,
``api/src/lib/sdFishReports.ts``). Anything the app hasn't confirmed live is
listed in ``VERIFY`` and copied into ``gaps.json``.

No reservation sites, onX or Gaia, ever. No scraping beyond the official
endpoints below (one request per second per host, cached).
"""

from __future__ import annotations

from urllib.parse import quote, urlencode

# ------------------------------------------------------------------ cache folders (ml/cache/<source>/)

SRC_LF = "mn-lakefinder"  # by_point lake lists, lake_survey, stocking/regs detail pages, lake page
SRC_MN_ACCESS = "mn-water-access"  # DNR water access sites FeatureServer
SRC_OSM = "osm-overpass"
SRC_GFP_REPORTS = "sd-gfp-reports"  # Fishery Reports list pages + PDFs
SRC_GFP_GIS = "sd-gfp-gis"  # gfpgis.sd.gov ArcGIS

# ------------------------------------------------------------------ boxes [west, south, east, north]

MN_BOX = (-97.3, 43.4, -89.4, 49.4)
SD_BOX = (-104.1, 42.4, -96.4, 46.0)
# SD's eastern border is about -96.44 (MN/IA beyond); lakes centred east of it are not SD's.
SD_EAST_LNG = -96.44

# ------------------------------------------------------------------ MN DNR LakeFinder

LF_DETAIL = "https://maps.dnr.state.mn.us/cgi-bin/lakefinder/detail.cgi"
LF_BY_POINT = "https://services.dnr.state.mn.us/api/lakefinder/by_point/v1"
LF_PAGE = "https://www.dnr.state.mn.us/lakefind/lake.html"


def lf_detail_url(kind: str, dow: str) -> str:
    """Same parameters the app sends, minus its cache-busting ``_=`` (so the cache key is stable)."""
    return f"{LF_DETAIL}?{urlencode({'type': kind, 'callback': '', 'id': dow})}"


def lf_survey_url(dow: str) -> str:
    return lf_detail_url("lake_survey", dow)


def lf_by_point_url(lat: float, lng: float, radius_m: float, scheme: str = "https") -> str:
    base = LF_BY_POINT if scheme == "https" else LF_BY_POINT.replace("https:", "http:")
    return f"{base}?lat={lat:.5f}&lon={lng:.5f}&radius={round(radius_m)}"


def lf_page_url(dow: str) -> str:
    """The lake's official LakeFinder page (maps, surveys, stocking, regulations)."""
    return f"{LF_PAGE}?id={dow}"


# by_point: radius (m) per grid point and the answer size that suggests the API capped the list.
LF_GRID_KM = 28.0  # grid spacing; radius = spacing / sqrt(2) + 1 km so circles cover the cells
LF_RESULT_CAP = 500  # verify: if an answer has at least this many lakes, the cell is split in four

# Detail page types other than lake_survey: discovered from LakeFinder's own lake page/scripts,
# overridable on the CLI. None are confirmed from the sandbox (verify).
LF_TYPE_PATTERNS = {"stocking": r"stock", "regs": r"reg"}

# ------------------------------------------------------------------ MN DNR water access

WATER_ACCESS_SERVICES: list[tuple[str, str]] = [
    ("https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_water_access_sites/FeatureServer", "DNR public water accesses"),
    ("https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_water_access_sites/MapServer", "DNR public water accesses (map service)"),
    ("https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/loc_water_access_sites/FeatureServer", "DNR water accesses (older address)"),
]
ARCGIS_PAGE = 1000  # records per query page (lowered automatically to the layer's maxRecordCount)

# ------------------------------------------------------------------ SD GFP

SD_REPORTS_BASE = "https://apps.sd.gov/GF56FisheriesReports/"


def _encode_uri_component(s: str) -> str:
    return quote(s, safe="-_.!~*'()")


def gfp_list_url(water: str) -> str:
    """Same as ``reportListUrl`` in api/src/lib/sdFishReports.ts."""
    return f"{SD_REPORTS_BASE}?Waterbody={_encode_uri_component(water).replace('%20', '+')}"


def gfp_pdf_url(report_id: str) -> str:
    return f"{SD_REPORTS_BASE}ExportPDF.ashx?ReportID={report_id}"


SD_GFP_SERVER = "https://gfpgis.sd.gov/arcgis/rest/services"
SD_GFP_FOLDERS = ["Parks", "Fisheries", "Public_Lands"]
SD_GFP_LABEL = "SD GFP boat ramps"

# ------------------------------------------------------------------ OpenStreetMap

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSM_LABEL = "OpenStreetMap (community map data)"
OSM_ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)"
OSM_TILE_DEG = 1.0  # Overpass queries cover 1° × 1° cells of SD

# ------------------------------------------------------------------ freshness (days before a cached answer is refetched)

MAX_AGE_DAYS = {
    "lake_list": 90,  # LakeFinder by_point, Overpass, ArcGIS layer lists
    "survey": 60,  # LakeFinder lake_survey, stocking, regs
    "access": 30,  # water access features
    "gfp_list": 30,  # GFP report lists
    "pdf": None,  # GFP PDFs by ReportID don't change: never refetched
}

# ------------------------------------------------------------------ registry for the manifest

SOURCES: list[dict[str, str]] = [
    {
        "key": SRC_LF,
        "name": "Minnesota DNR LakeFinder (lake surveys, lake list, stocking, special regulations)",
        "url": "https://www.dnr.state.mn.us/lakefind/index.html",
        "terms": "Official public data from the Minnesota DNR; shown with a link to each lake's LakeFinder page. Check the DNR site for terms of use (verify).",
    },
    {
        "key": SRC_MN_ACCESS,
        "name": "Minnesota DNR Public Water Access Sites (Minnesota Geospatial Commons)",
        "url": WATER_ACCESS_SERVICES[0][0],
        "terms": "Official public GIS data from the Minnesota DNR via the Minnesota Geospatial Commons (verify the dataset's license).",
    },
    {
        "key": SRC_GFP_REPORTS,
        "name": "South Dakota GFP Fishery Reports (lake survey PDFs)",
        "url": SD_REPORTS_BASE,
        "terms": "Official public reports from South Dakota Game, Fish and Parks; each estimate links its PDF (verify terms).",
    },
    {
        "key": SRC_GFP_GIS,
        "name": "South Dakota GFP GIS (boat ramps / water access)",
        "url": SD_GFP_SERVER,
        "terms": "Official public GIS services from South Dakota GFP (layer found by name at run time; verify).",
    },
    {
        "key": SRC_OSM,
        "name": "OpenStreetMap via Overpass API (SD lakes, boat ramps)",
        "url": OVERPASS_URL,
        "terms": OSM_ATTRIBUTION + ". Community data: check on site.",
    },
]

# ------------------------------------------------------------------ things not confirmed from the build sandbox

VERIFY: list[str] = [
    "LakeFinder by_point: the maximum radius and whether answers are capped (LF_RESULT_CAP splits a grid cell when an answer reaches it).",
    "LakeFinder lake_survey: lake feature keys (areaAcres / maxDepth / averageWaterClarity / region etc.) are matched loosely and not confirmed.",
    "LakeFinder lake_survey: length distribution key and shape (matched loosely: any survey key containing 'length').",
    "LakeFinder lake_survey: electrofishing gearCount is not hours; effort for electrofishing is totalCatch / CPUE when both are published.",
    "LakeFinder stocking and special-regulation detail types (type=...) are discovered from LakeFinder's lake page at run time; their JSON shapes are matched loosely.",
    "DNR water access: ramp/DOW attribute names are found by pattern like the app (waterAccess.ts).",
    "SD GFP GIS: boat ramp layer is found by name in the Parks/Fisheries/Public_Lands folders.",
    "SD GFP Fishery Reports: ?Waterbody= search may list reports of several same-named lakes.",
    "SD lakes: state membership is a box test (east of -96.44 is dropped); border lakes may be shared with MN/ND/NE/IA.",
    "SD lake area is computed from OpenStreetMap outlines (approximate); depth and clarity are not available.",
]
