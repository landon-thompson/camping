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
function centroid(geometry: Feature['geometry']): { lat: number; lng: number } | null {
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
  // Sanity: Minnesota only.
  if (!(lat >= 43 && lat <= 49.5 && lng >= -97.5 && lng <= -89)) return null;
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

export function parseParksDetailed(data: unknown, parksLayer = false): ParseResult {
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
    const typed = /state park|recreation area|\bSP\b|\bSRA\b/i;
    const isPark = typed.test(raw) || typed.test(allText);
    // Statewide parks-and-trails layers also hold state trails, forests, water accesses…
    const notAPark = /\btrail\b|forest|water access|wildlife|fish|scientific|wayside|office|district|region|area \d/i;
    if (!isPark && (!parksLayer || notAPark.test(raw) || notAPark.test(allText))) continue;
    let name = raw.replace(/\bSP\b/, 'State Park').replace(/\bSRA\b/, 'State Recreation Area');
    if (!/state (park|recreation area)/i.test(name)) {
      name += /recreation area|\bSRA\b/i.test(allText) ? ' State Recreation Area' : ' State Park';
    }
    name = name.replace(/\s+/g, ' ').trim();
    const c = centroid(f.geometry);
    const unitId = Object.values(f.properties ?? {}).find((v): v is string => typeof v === 'string' && /^s(pk|ra)\d{5}$/i.test(v.trim()));
    if (c && !byName.has(normalizeName(name))) byName.set(normalizeName(name), { name, ...c, ...(unitId ? { unitId: unitId.trim().toLowerCase() } : {}) });
  }
  return {
    parks: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    featureCount: features.length,
    sampleFields: Object.keys(features[0]?.properties ?? {}).slice(0, 12),
  };
}

export function parseParks(geojson: unknown, parksLayer = false): ParkPoint[] {
  return parseParksDetailed(geojson, parksLayer).parks;
}

export function normalizeName(n: string): string {
  return n
    .toLowerCase()
    .replace(/state (park|recreation area)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parkId(name: string): string {
  return `campground:mn-sp-${normalizeName(name).replace(/ /g, '-')}`;
}

export function parkCampground(p: ParkPoint, source: string): Campground {
  return {
    name: p.name,
    agency: 'mn-state-park',
    bookingSystem: 'reservemn',
    unit: p.name,
    location: { lat: p.lat, lng: p.lng },
    bookingUrl: p.unitId ? dnrParkPageUrl(p.unitId) : 'https://www.mndnr.gov/reservations',
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
      add.push({ id: parkId(p.name), data: parkCampground(p, source) });
    }
  }
  return { add, fill };
}

async function httpError(res: Response): Promise<Error> {
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

async function fetchFromService(base: string, fetchFn: typeof fetch): Promise<ParseResult & { layerName: string }> {
  // A layer URL (…/FeatureServer/0) can be queried directly.
  const direct = base.match(/^(.*\/(?:FeatureServer|MapServer))\/(\d+)$/);
  if (direct) return queryLayer(direct[1]!, Number(direct[2]), 'State parks', fetchFn);
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
  return queryLayer(base, layer.id, layer.name, fetchFn);
}

async function queryLayer(service: string, id: number, name: string, fetchFn: typeof fetch): Promise<ParseResult & { layerName: string }> {
  // Esri JSON works on every ArcGIS Server version; GeoJSON output isn't always enabled.
  const q = `${service}/${id}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&f=json`;
  const res = await fetchFn(q);
  if (!res.ok) throw await httpError(res);
  return { ...parseParksDetailed(await res.json(), true), layerName: name };
}

export interface SourceReport {
  source: string;
  label: string;
  outcome: string;
}

const SOURCES: [string, string][] = [
  ...MN_PARKS_ITEMS.map((id, i): [string, string] => [`item:${id}`, i === 0 ? 'MN Geospatial Commons (DNR)' : 'UMN copy of DNR data']),
  [MN_DNR_PARKS_SERVICE, 'DNR statewide (hosted)'],
  [MN_DNR_SLAM_SERVICE, 'DNR statewide (SLAM)'],
  [MN_PARKS_SERVICE, 'Met Council (metro only)'],
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
): Promise<ParseResult & { layerName: string; source: string; reports: SourceReport[] }> {
  let best: (ParseResult & { layerName: string; source: string }) | null = null;
  const reports: SourceReport[] = [];
  for (const [base, label] of SOURCES) {
    try {
      const service = base.startsWith('item:') ? await resolveItem(base.slice(5), fetchFn) : base;
      const r = { ...(await fetchFromService(service, fetchFn)), source: service };
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
