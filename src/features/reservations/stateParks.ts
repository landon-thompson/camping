import type { Campground } from '../../model/schemas';

/**
 * Import Minnesota state parks from official GIS data (MN DNR boundaries).
 * Runs on the phone: the build sandbox can't reach state servers, so the
 * automatic source below is best-effort and a file import is the fallback.
 */

/**
 * Official sources, tried in order (unverified from the build sandbox, which can't reach them):
 *  1. MN DNR's statewide Division of Parks and Trails area boundaries (hosted feature service).
 *  2. Metropolitan Council's parks service (Twin Cities metro only) as a fallback.
 */
export const MN_DNR_PARKS_SERVICE =
  'https://arcgis.dnr.state.mn.us/host/rest/services/Hosted/DNR_Division_of_Parks_and_Trails_Area_Boundaries/FeatureServer';
export const MN_DNR_SLAM_SERVICE = 'https://arcgis.dnr.state.mn.us/mndnr/rest/services/slam/SLAM_App_Layers/MapServer';
export const MN_PARKS_SERVICE = 'https://gis.metc.state.mn.us/arcgis/rest/services/LPH/Parks/MapServer';

/**
 * ArcGIS catalog items for the DNR dataset "State Parks, Recreation Areas, and
 * Waysides" (statutory boundaries, statewide), as listed on the Minnesota
 * Geospatial Commons (gis.data.mn.gov) and the UMN hub. The item record says
 * where the live data is served.
 */
export const MN_PARKS_ITEMS = ['a42128766db2447cb77a247d4a074173', '3a9ede9083f64fb1a773bf63df1a392a'];

/** A park's own official DNR page, from its DNR unit id (e.g. spk00181 = Itasca). */
export function dnrParkPageUrl(unitId: string): string {
  return `https://www.dnr.state.mn.us/state_parks/park.html?id=${unitId.toLowerCase()}#reservations`;
}

/** Official download page for the statewide boundary file (GeoJSON), for the file fallback. */
/**
 * South Dakota: "Parks And Recreation Areas" (State of South Dakota open data,
 * SD GFP) — state parks, recreation areas and more, statewide.
 */
export const SD_PARKS_ITEMS = ['cfcb6562b1cd4e1287e836b2df60426f'];
export const SD_PARKS_DATASET_URL = 'https://opendata2017-09-18t192802468z-sdbit.opendata.arcgis.com/datasets/cfcb6562b1cd4e1287e836b2df60426f_0/about';

export type ParkRegion = 'mn' | 'sd';
/** [south, north, west, east] sanity bounds for pins. */
export const REGION_BOUNDS: Record<ParkRegion, [number, number, number, number]> = {
  mn: [43, 49.5, -97.5, -89],
  sd: [42.4, 46, -104.1, -96.4],
};
export const REGION_NAME: Record<ParkRegion, string> = { mn: 'Minnesota', sd: 'South Dakota' };

export const MN_PARKS_DATASET_URL = 'https://gisdata.mn.gov/dataset?q=state+park+boundaries';

export interface ParkPoint {
  name: string;
  lat: number;
  lng: number;
  /** DNR unit id like spk00181, when the data carries it. */
  unitId?: string;
}

type Position = number[];
interface Feature {
  type?: string;
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

/** Web Mercator (EPSG:3857) metres → lon/lat. */
function fromWebMercator(x: number, y: number): [number, number] {
  const lng = (x / 6378137) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  return [lng, lat];
}

/** UTM zone 15N metres (NAD83/WGS84, EPSG:26915 — Minnesota's standard GIS system) → lon/lat. */
function fromUtm15N(easting: number, northing: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  const m = northing / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = ep2 * Math.cos(phi1) ** 2;
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = x / (n1 * k0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lng0 = (-93 * Math.PI) / 180; // zone 15 central meridian
  const lng = lng0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(phi1);
  return [(lng * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Turn a coordinate pair into lon/lat, whichever common system it arrived in. */
export function toLonLat(x: number, y: number): [number, number] {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return [x, y];
  if (x < -1e6) return fromWebMercator(x, y); // Web Mercator: Minnesota x ≈ -1.08e7…-9.9e6
  if (x > 1e5 && x < 1e6 && y > 4e6 && y < 6e6) return fromUtm15N(x, y);
  return [NaN, NaN];
}

/** Average of a polygon's outer-ring vertices: good enough for a map pin. */
function centroid(geometry: Feature['geometry'], region: ParkRegion = 'mn'): { lat: number; lng: number } | null {
  if (!geometry) return null;
  let rings: Position[][] = [];
  if (geometry.type === 'Polygon') rings = [(geometry.coordinates as Position[][])[0] ?? []];
  else if (geometry.type === 'MultiPolygon') rings = (geometry.coordinates as Position[][][]).map((p) => p[0] ?? []);
  else if (geometry.type === 'Point') rings = [[geometry.coordinates as Position]];
  else return null;
  // Use the largest part (most vertices) so a small detached parcel doesn't pull the pin.
  const ring = rings.reduce<Position[]>((a, b) => (b.length > a.length ? b : a), []);
  if (ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p[0] ?? 0;
    sy += p[1] ?? 0;
  }
  const [lng, lat] = toLonLat(sx / ring.length, sy / ring.length);
  // Sanity: inside the state being imported.
  const [s, n, w, e] = REGION_BOUNDS[region];
  if (!(lat >= s && lat <= n && lng >= w && lng <= e)) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

function featureName(props: Record<string, unknown> | null | undefined): string | null {
  if (!props) return null;
  const keys = Object.keys(props);
  const key =
    keys.find((k) => /^(area_?name|park_?name|name|unit_?name)$/i.test(k)) ?? keys.find((k) => /name/i.test(k));
  const v = key ? props[key] : null;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export interface ParseResult {
  parks: ParkPoint[];
  /** How many map features came in, and the field names of the first — for troubleshooting. */
  featureCount: number;
  sampleFields: string[];
}

/**
 * Keep state parks and state recreation areas (not waysides), one point per name.
 * `parksLayer`: the source is known to be a state-parks layer, so accept any
 * named feature even if the name itself doesn't say "State Park".
 */
/** Esri JSON features ({attributes, geometry:{rings|x,y}}) → GeoJSON-like features. */
function fromEsri(features: unknown[]): Feature[] {
  return features.map((raw) => {
    const f = raw as { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][]; x?: number; y?: number } };
    const g = f.geometry;
    const geometry = g?.rings
      ? { type: 'MultiPolygon', coordinates: g.rings.map((r) => [r]) }
      : g && typeof g.x === 'number'
        ? { type: 'Point', coordinates: [g.x, g.y] }
        : null;
    return { properties: f.attributes ?? {}, geometry };
  });
}

export function parseParksDetailed(data: unknown, parksLayer = false, region: ParkRegion = 'mn'): ParseResult {
  let features = (data as { features?: Feature[] })?.features;
  if (Array.isArray(features) && features.length > 0 && 'attributes' in (features[0] as object)) {
    features = fromEsri(features);
  }
  if (!Array.isArray(features)) {
    const err = (data as { error?: { code?: number; message?: string } })?.error;
    throw new Error(err ? `Service error ${err.code ?? ''} ${err.message ?? ''}`.trim() : 'That file isn’t GeoJSON map data.');
  }
  const byName = new Map<string, ParkPoint>();
  for (const f of features) {
    const raw = featureName(f.properties);
    if (!raw) continue;
    const allText = Object.values(f.properties ?? {})
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    if (/wayside/i.test(raw) || (/wayside/i.test(allText) && !/state park/i.test(allText))) continue;
    // SD GFP's layer also holds lakeside use areas, nature areas, trails and marinas.
    if (/lakeside use|nature area|marina|trailhead/i.test(raw)) continue;
    const typed = /state park|recreation area|\bSP\b|\bSRA\b/i;
    const isPark = typed.test(raw) || typed.test(allText);
    // Statewide parks-and-trails layers also hold state trails, forests, water accesses…
    const notAPark = /\btrail\b|forest|water access|wildlife|fish|scientific|wayside|office|district|region|area \d/i;
    if (!isPark && (!parksLayer || notAPark.test(raw) || notAPark.test(allText))) continue;
    let name = titleCase(raw).replace(/\bSP\b/, 'State Park').replace(/\bSRA\b/, region === 'sd' ? 'Recreation Area' : 'State Recreation Area');
    // Minnesota says "State Recreation Area"; South Dakota just "Recreation Area".
    if (!/state park|recreation area/i.test(name)) {
      name += /recreation area|\bSRA\b/i.test(allText) ? (region === 'sd' ? ' Recreation Area' : ' State Recreation Area') : ' State Park';
    }
    name = name.replace(/\s+/g, ' ').trim();
    const c = centroid(f.geometry, region);
    const unitId = Object.values(f.properties ?? {}).find((v): v is string => typeof v === 'string' && /^s(pk|ra)\d{5}$/i.test(v.trim()));
    if (c && !byName.has(normalizeName(name))) byName.set(normalizeName(name), { name, ...c, ...(unitId ? { unitId: unitId.trim().toLowerCase() } : {}) });
  }
  return {
    parks: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    featureCount: features.length,
    sampleFields: Object.keys(features[0]?.properties ?? {}).slice(0, 12),
  };
}

/** "CUSTER STATE PARK" → "Custer State Park"; mixed-case names are left alone. */
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function parseParks(geojson: unknown, parksLayer = false, region: ParkRegion = 'mn'): ParkPoint[] {
  return parseParksDetailed(geojson, parksLayer, region).parks;
}

export function normalizeName(n: string): string {
  return n
    .toLowerCase()
    .replace(/state (park|recreation area)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parkId(name: string, region: ParkRegion = 'mn'): string {
  return `campground:${region}-sp-${normalizeName(name).replace(/ /g, '-')}`;
}

export function parkCampground(p: ParkPoint, source: string, region: ParkRegion = 'mn'): Campground {
  const custer = region === 'sd' && /^custer state park$/i.test(p.name);
  return {
    name: p.name,
    agency: region === 'sd' ? 'sd-state-park' : 'mn-state-park',
    bookingSystem: region === 'sd' ? 'campsd' : 'reservemn',
    unit: p.name,
    location: { lat: p.lat, lng: p.lng },
    bookingUrl: region === 'sd' ? 'https://www.campsd.com' : p.unitId ? dnrParkPageUrl(p.unitId) : 'https://www.mndnr.gov/reservations',
    ...(custer
      ? {
          windowMonthsOverride: {
            value: 12,
            status: 'verify' as const,
            source: 'From research on gfp.sd.gov — Custer State Park reservations open one year before arrival; verify on campsd.com',
          },
        }
      : {}),
    ridbFacilityId: null,
    windowDaysOverride: null,
    electric: null,
    boatLaunch: null,
    rules: [],
    verify:
      'Imported from official park boundary data: the pin is the park’s middle, not the campground. Check electric sites, boat launch and the exact booking page.',
    source,
    notes: '',
  };
}

const GENERIC_LINK = /^https?:\/\/(www\.)?mndnr\.gov\/reservations\/?$|^$/i;

/** Plan an import: new parks to add, and existing records (same name) whose missing location can be filled. */
export function planImport(
  parks: ParkPoint[],
  existing: { id: string; data: Campground }[],
  source: string,
  region: ParkRegion = 'mn',
): { add: { id: string; data: Campground }[]; fill: { id: string; data: Campground }[] } {
  const byName = new Map(existing.map((e) => [normalizeName(e.data.name), e]));
  const add: { id: string; data: Campground }[] = [];
  const fill: { id: string; data: Campground }[] = [];
  for (const p of parks) {
    const match = byName.get(normalizeName(p.name));
    if (match) {
      const needsLocation = !match.data.location;
      const betterLink = p.unitId && GENERIC_LINK.test(match.data.bookingUrl);
      if (needsLocation || betterLink) {
        fill.push({
          id: match.id,
          data: {
            ...match.data,
            location: match.data.location ?? { lat: p.lat, lng: p.lng },
            bookingUrl: betterLink ? dnrParkPageUrl(p.unitId!) : match.data.bookingUrl,
          },
        });
      }
    } else {
      add.push({ id: parkId(p.name, region), data: parkCampground(p, source, region) });
    }
  }
  return { add, fill };
}

export async function httpError(res: Response): Promise<Error> {
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: string | { message?: string } }).error as string;
    if (detail && typeof detail === 'object') detail = (detail as { message?: string }).message ?? '';
  } catch {
    /* not JSON */
  }
  return new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
}

/** Find where an ArcGIS catalog item's data is served (service or layer URL). */
async function resolveItem(itemId: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(`https://www.arcgis.com/sharing/rest/content/items/${itemId}?f=json`);
  if (!res.ok) throw await httpError(res);
  const item = (await res.json()) as { url?: string; error?: { message?: string } };
  if (item.error) throw new Error(item.error.message ?? 'item lookup failed');
  if (!item.url) throw new Error('item has no service address');
  return item.url.replace(/\/+$/, '');
}

async function fetchFromService(base: string, fetchFn: typeof fetch, region: ParkRegion = 'mn'): Promise<ParseResult & { layerName: string }> {
  // A layer URL (…/FeatureServer/0) can be queried directly.
  const direct = base.match(/^(.*\/(?:FeatureServer|MapServer))\/(\d+)$/);
  if (direct) return queryLayer(direct[1]!, Number(direct[2]), 'State parks', fetchFn, region);
  const layersRes = await fetchFn(`${base}/layers?f=json`);
  if (!layersRes.ok) throw await httpError(layersRes);
  const meta = (await layersRes.json()) as { layers?: { id: number; name: string }[]; error?: { code?: number; message?: string } };
  if (meta.error) throw new Error(`error ${meta.error.code ?? ''} ${meta.error.message ?? ''}`.trim());
  const layers = meta.layers ?? [];
  const layer =
    layers.find((l) => /state park/i.test(l.name)) ??
    layers.find((l) => /parks and trails area|park/i.test(l.name)) ??
    layers[0];
  if (!layer) throw new Error('no layers');
  return queryLayer(base, layer.id, layer.name, fetchFn, region);
}

async function queryLayer(service: string, id: number, name: string, fetchFn: typeof fetch, region: ParkRegion = 'mn'): Promise<ParseResult & { layerName: string }> {
  // Esri JSON works on every ArcGIS Server version; GeoJSON output isn't always enabled.
  const q = `${service}/${id}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&f=json`;
  const res = await fetchFn(q);
  if (!res.ok) throw await httpError(res);
  return { ...parseParksDetailed(await res.json(), true, region), layerName: name };
}

export interface SourceReport {
  source: string;
  label: string;
  outcome: string;
}

/** GFP's own map server; its Parks folder holds the park boundary layer (found by name — the address isn't documented). */
export const SD_GFP_PARKS_FOLDER = 'https://gfpgis.sd.gov/arcgis/rest/services/Parks';

/**
 * USGS Protected Areas Database (PAD-US 3.0), USGS's own public service (the
 * "Manager_Name" layer the FedData R package reads). Esri's Living Atlas copy
 * needs a subscriber token, so it isn't used. Filtered to one state's parks.
 */
export const PADUS_STATE_LAYER = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name/FeatureServer/0';
const PADUS_STATE: Record<ParkRegion, string> = { mn: 'MN', sd: 'SD' };

/** PAD-US query for a state's state parks (SP) and state recreation areas (SREC). */
export function padusQueryUrl(region: ParkRegion): string {
  const p = new URLSearchParams({
    where: `State_Nm = '${PADUS_STATE[region]}' AND Des_Tp IN ('SP','SREC')`,
    outFields: 'Unit_Nm,Loc_Ds,Des_Tp,State_Nm',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.001',
    resultRecordCount: '2000',
    f: 'json',
  });
  return `${PADUS_STATE_LAYER}/query?${p}`;
}

/** PAD-US attributes → the name/type fields the park parser reads. */
export function fromPadus(data: unknown): unknown {
  const d = data as { features?: { attributes?: Record<string, unknown>; geometry?: unknown }[]; error?: unknown };
  if (!Array.isArray(d?.features)) return data;
  return {
    features: d.features.map((f) => {
      const a = f.attributes ?? {};
      const type = a.Des_Tp === 'SREC' ? 'Recreation Area' : 'State Park';
      return { attributes: { NAME: String(a.Unit_Nm ?? '').trim(), TYPE: String(a.Loc_Ds || type) }, geometry: f.geometry };
    }),
  };
}

const SD_SOURCES: [string, string][] = [
  ['padus:sd', 'USGS PAD-US (national protected areas)'],
  [`gfp:${SD_GFP_PARKS_FOLDER}`, 'SD GFP map server (Parks folder)'],
  ...SD_PARKS_ITEMS.map((id): [string, string] => [`item:${id}`, 'SD open data: Parks and Recreation Areas']),
];

/**
 * Find the park-boundary layer in an ArcGIS folder: services named like parks
 * first, then a polygon layer whose name says park / boundary / recreation area.
 * Returns a layer URL (…/MapServer/3) that fetchFromService queries directly.
 */
export async function discoverParkLayer(folderUrl: string, fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(`${folderUrl}?f=json`);
  if (!res.ok) throw await httpError(res);
  const folder = (await res.json()) as { services?: { name: string; type: string }[]; error?: { message?: string } };
  if (folder.error) throw new Error(folder.error.message ?? 'folder listing failed');
  const root = folderUrl.replace(/\/[^/]+$/, '');
  const services = (folder.services ?? []).filter((x) => /^(MapServer|FeatureServer)$/.test(x.type));
  const score = (n: string) => (/boundar/i.test(n) ? 0 : /state_?park|park/i.test(n) ? 1 : 2);
  const ordered = services.filter((x) => !/ramp|trail|campsite|asset|cartegraph/i.test(x.name)).sort((a, b) => score(a.name) - score(b.name));
  const tried: string[] = [];
  for (const svc of ordered.slice(0, 8)) {
    const base = `${root}/${svc.name}/${svc.type}`;
    tried.push(svc.name);
    try {
      const lr = await fetchFn(`${base}/layers?f=json`);
      if (!lr.ok) continue;
      const layers = ((await lr.json()) as { layers?: { id: number; name: string; geometryType?: string }[] }).layers ?? [];
      const poly = layers.filter((l) => /polygon/i.test(l.geometryType ?? 'polygon'));
      const layer =
        poly.find((l) => /state park|recreation area|park boundar|parks?_?boundar/i.test(l.name)) ?? poly.find((l) => /park|boundar/i.test(l.name));
      if (layer) return `${base}/${layer.id}`;
    } catch {
      /* next service */
    }
  }
  throw new Error(tried.length ? `no park boundary layer in ${tried.join(', ')}` : 'no map services in the folder');
}

const SOURCES: [string, string][] = [
  ...MN_PARKS_ITEMS.map((id, i): [string, string] => [`item:${id}`, i === 0 ? 'MN Geospatial Commons (DNR)' : 'UMN copy of DNR data']),
  [MN_DNR_PARKS_SERVICE, 'DNR statewide (hosted)'],
  [MN_DNR_SLAM_SERVICE, 'DNR statewide (SLAM)'],
  [MN_PARKS_SERVICE, 'Met Council (metro only)'],
  ['padus:mn', 'USGS PAD-US (national protected areas)'],
];

/**
 * Fetch through the app's own API (/api/gis), because the DNR servers don't
 * allow browsers to read them directly (no CORS). Falls back to a direct
 * request when there's no API (preview / local dev).
 */
export const viaAppServer: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  try {
    const r = await fetch(`/api/gis?url=${encodeURIComponent(url)}`, { credentials: 'same-origin', ...init });
    const type = r.headers.get('content-type') ?? '';
    if (r.ok && type.includes('json')) return r;
    if (r.status !== 404 && type.includes('json')) {
      // The server couldn't get it; the phone may still be allowed to (CORS-enabled hosts).
      try {
        const direct = await fetch(input, init);
        if (direct.ok) return direct;
      } catch {
        /* keep the server's explanation */
      }
      return r;
    }
  } catch {
    /* no API reachable — try directly */
  }
  return fetch(input, init);
};

/** Try each official source; keep the one with the most parks, and report what each returned. */
export async function fetchParksFromService(
  fetchFn: typeof fetch = fetch,
  region: ParkRegion = 'mn',
): Promise<ParseResult & { layerName: string; source: string; reports: SourceReport[] }> {
  let best: (ParseResult & { layerName: string; source: string }) | null = null;
  const reports: SourceReport[] = [];
  for (const [base, label] of region === 'sd' ? SD_SOURCES : SOURCES) {
    try {
      if (base.startsWith('padus:')) {
        const res = await fetchFn(padusQueryUrl(region));
        if (!res.ok) throw await httpError(res);
        const r = { ...parseParksDetailed(fromPadus(await res.json()), true, region), layerName: 'PAD-US 3.0 (USGS)', source: PADUS_STATE_LAYER };
        reports.push({ source: base, label, outcome: `${r.parks.length} parks from ${r.featureCount} areas (layer “${r.layerName}”)` });
        if (!best || r.parks.length > best.parks.length) best = r;
        if (r.parks.length > 40) break;
        continue;
      }
      const service = base.startsWith('item:')
        ? await resolveItem(base.slice(5), fetchFn)
        : base.startsWith('gfp:')
          ? await discoverParkLayer(base.slice(4), fetchFn)
          : base;
      const r = { ...(await fetchFromService(service, fetchFn, region)), source: service };
      reports.push({ source: base, label, outcome: `${r.parks.length} parks from ${r.featureCount} areas (layer “${r.layerName}”)` });
      if (!best || r.parks.length > best.parks.length) best = r;
      if (r.parks.length > 40) break; // statewide list found — no need to try more
    } catch (e) {
      reports.push({ source: base, label, outcome: e instanceof TypeError ? 'couldn’t connect' : e instanceof Error ? e.message : 'failed' });
    }
  }
  if (!best) throw Object.assign(new Error('Couldn’t reach the state map services.'), { reports });
  return { ...best, reports };
}
