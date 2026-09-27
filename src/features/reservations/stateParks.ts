import type { Campground } from '../../model/schemas';

/**
 * Import Minnesota state parks from official GIS data (MN DNR boundaries).
 * Runs on the phone: the build sandbox can't reach state servers, so the
 * automatic source below is best-effort and a file import is the fallback.
 */

/** Metropolitan Council's public map service, which republishes DNR layers. Unverified from the build sandbox. */
export const MN_PARKS_SERVICE = 'https://gis.metc.state.mn.us/arcgis/rest/services/LPH/Parks/MapServer';

/** Official download page for the statewide boundary file (GeoJSON), for the file fallback. */
export const MN_PARKS_DATASET_URL = 'https://gisdata.mn.gov/dataset?q=state+park+boundaries';

export interface ParkPoint {
  name: string;
  lat: number;
  lng: number;
}

type Position = number[];
interface Feature {
  type?: string;
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

/** Average of a polygon's outer-ring vertices: good enough for a map pin. */
function centroid(geometry: Feature['geometry']): { lat: number; lng: number } | null {
  if (!geometry) return null;
  let rings: Position[][] = [];
  if (geometry.type === 'Polygon') rings = [(geometry.coordinates as Position[][])[0] ?? []];
  else if (geometry.type === 'MultiPolygon') rings = (geometry.coordinates as Position[][][]).map((p) => p[0] ?? []);
  else if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as Position;
    return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
  } else return null;
  // Use the largest part (most vertices) so a small detached parcel doesn't pull the pin.
  const ring = rings.reduce<Position[]>((a, b) => (b.length > a.length ? b : a), []);
  if (ring.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of ring) {
    lng += p[0] ?? 0;
    lat += p[1] ?? 0;
  }
  lat /= ring.length;
  lng /= ring.length;
  // Sanity: Minnesota only (rejects data in the wrong coordinate system).
  if (lat < 43 || lat > 49.5 || lng < -97.5 || lng > -89) return null;
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

/** Keep state parks and state recreation areas (not waysides), one point per name. */
export function parseParks(geojson: unknown): ParkPoint[] {
  const features = (geojson as { features?: Feature[] })?.features;
  if (!Array.isArray(features)) throw new Error('That file isn’t GeoJSON map data.');
  const byName = new Map<string, ParkPoint>();
  for (const f of features) {
    const raw = featureName(f.properties);
    if (!raw || !/state park|recreation area|\bSP\b|\bSRA\b/i.test(raw) || /wayside/i.test(raw)) continue;
    const name = raw.replace(/\bSP\b/, 'State Park').replace(/\bSRA\b/, 'State Recreation Area');
    const c = centroid(f.geometry);
    if (c && !byName.has(normalizeName(name))) byName.set(normalizeName(name), { name, ...c });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
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
    bookingUrl: 'https://www.mndnr.gov/reservations',
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
      if (!match.data.location) fill.push({ id: match.id, data: { ...match.data, location: { lat: p.lat, lng: p.lng } } });
    } else {
      add.push({ id: parkId(p.name), data: parkCampground(p, source) });
    }
  }
  return { add, fill };
}

/** Automatic source: find the state-park layer in the published service and fetch it as GeoJSON. */
export async function fetchParksFromService(fetchFn: typeof fetch = fetch): Promise<ParkPoint[]> {
  const layersRes = await fetchFn(`${MN_PARKS_SERVICE}/layers?f=json`);
  if (!layersRes.ok) throw new Error(`The state map service answered ${layersRes.status}.`);
  const layers = ((await layersRes.json()) as { layers?: { id: number; name: string }[] }).layers ?? [];
  const layer = layers.find((l) => /state park/i.test(l.name));
  if (!layer) throw new Error('The state map service has no state-park layer.');
  const q = `${MN_PARKS_SERVICE}/${layer.id}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
  const res = await fetchFn(q);
  if (!res.ok) throw new Error(`The state map service answered ${res.status}.`);
  return parseParks(await res.json());
}
