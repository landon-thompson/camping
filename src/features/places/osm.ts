import type { BoatLaunchSite, NamedWater } from '../../model/schemas';
import { bboxAround, distanceKm } from './arcgis';

/**
 * OpenStreetMap (open data, © OpenStreetMap contributors, ODbL) via the public
 * Overpass API: boat ramps (leisure=slipway) and named lakes/reservoirs. Used
 * where no official launch/lake data is public (South Dakota). Community data:
 * shown as such, check on site.
 */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const OSM_LABEL = 'OpenStreetMap (community map data)';

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

export function overpassQuery(at: { lat: number; lng: number }, km: number): string {
  const [w, s, e, n] = bboxAround(at.lat, at.lng, km);
  const box = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
  return [
    '[out:json][timeout:25];',
    `(node["leisure"="slipway"](${box});way["leisure"="slipway"](${box}););`,
    'out center tags;',
    `(way["natural"="water"]["name"](${box});relation["natural"="water"]["name"](${box}););`,
    // One geometry mode per `out`: bb (bounds) for lakes; the center is taken from the bounds.
    'out tags bb;',
  ].join('');
}

const NOT_A_LAKE = /^(river|stream|canal|ditch|wastewater|lagoon|basin|moat|fish_pass|stream_pool)$/;

/** How far a point is from a lake: 0 inside its bounding box, else to the box edge (km). */
export function distanceToWater(p: { lat: number; lng: number }, w: NamedWater): number {
  if (!w.bounds) return distanceKm(p, w);
  const [s, west, n, east] = w.bounds;
  const lat = Math.min(Math.max(p.lat, s), n);
  const lng = Math.min(Math.max(p.lng, west), east);
  return distanceKm(p, { lat, lng });
}

export function parseOverpass(data: unknown, at: { lat: number; lng: number }, maxKm: number): { launches: BoatLaunchSite[]; waters: NamedWater[] } {
  const elements = ((data as { elements?: OsmElement[] })?.elements ?? []).filter((e) => e && typeof e === 'object');
  const waters: NamedWater[] = [];
  const seenWater = new Set<string>();
  for (const e of elements) {
    const t = e.tags ?? {};
    if (t.natural !== 'water' || !t.name || NOT_A_LAKE.test(t.water ?? '')) continue;
    const bounds = e.bounds ? ([e.bounds.minlat, e.bounds.minlon, e.bounds.maxlat, e.bounds.maxlon] as [number, number, number, number]) : null;
    const c =
      e.center ??
      (bounds ? { lat: (bounds[0] + bounds[2]) / 2, lon: (bounds[1] + bounds[3]) / 2 } : e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
    if (!c) continue;
    const key = `${t.name}|${c.lat.toFixed(2)}|${c.lon.toFixed(2)}`;
    if (seenWater.has(key)) continue;
    seenWater.add(key);
    waters.push({ name: t.name, lat: c.lat, lng: c.lon, bounds, distanceKm: 0 });
  }
  for (const w of waters) w.distanceKm = Math.round(distanceToWater(at, w) * 10) / 10;

  const launches: BoatLaunchSite[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (t.leisure !== 'slipway') continue;
    const p = e.center ? { lat: e.center.lat, lng: e.center.lon } : e.lat != null && e.lon != null ? { lat: e.lat, lng: e.lon } : null;
    if (!p) continue;
    const d = distanceKm(at, p);
    if (d > maxKm) continue;
    // The lake it launches into: the nearest named water within 600 m of the ramp
    // (ramps are often mapped at the end of the access road, a little off the shoreline).
    let water = '';
    let best = 0.6;
    for (const w of waters) {
      const dw = distanceToWater(p, w);
      if (dw <= best) {
        best = dw;
        water = w.name;
      }
    }
    launches.push({
      name: t.name || (water ? `${water} boat ramp` : 'Boat ramp'),
      water,
      dow: null,
      ramp: [t.surface, t.access && t.access !== 'yes' ? `access: ${t.access}` : ''].filter(Boolean).join(', '),
      manager: t.operator ?? '',
      lat: p.lat,
      lng: p.lng,
      distanceKm: Math.round(d * 10) / 10,
    });
  }
  return {
    launches: launches.sort((a, b) => a.distanceKm - b.distanceKm),
    waters: waters.filter((w) => w.distanceKm <= maxKm).sort((a, b) => a.distanceKm - b.distanceKm),
  };
}

/** Boat ramps and named lakes around a point from OpenStreetMap (called directly; Overpass allows browsers). */
export async function fetchOsmWaters(
  at: { lat: number; lng: number },
  km: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ launches: BoatLaunchSite[]; waters: NamedWater[]; report: string }> {
  try {
    const res = await fetchFn(`${OVERPASS_URL}?data=${encodeURIComponent(overpassQuery(at, km))}`);
    if (!res.ok) return { launches: [], waters: [], report: `${OSM_LABEL}: HTTP ${res.status}` };
    const r = parseOverpass(await res.json(), at, km);
    return { ...r, report: `${OSM_LABEL}: ${r.launches.length} ramps, ${r.waters.length} named lakes within ${Math.round(km * 0.621371)} mi` };
  } catch (e) {
    return { launches: [], waters: [], report: `${OSM_LABEL}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
