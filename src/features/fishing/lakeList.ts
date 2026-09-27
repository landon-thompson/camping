import type { BoatLaunchSite, NamedWater, NearbyLake } from '../../model/schemas';
import { distanceKm } from '../places/arcgis';
import { distanceToWater } from '../places/osm';

/** Lakes to offer: LakeFinder's nearby lakes plus the lakes the launches go into (placed at their nearest launch). */
export function lakesFrom(nearby: NearbyLake[], launches: BoatLaunchSite[]): NearbyLake[] {
  const out = nearby.map((l) => ({ ...l }));
  for (const launch of launches) {
    if (!launch.dow) continue;
    const known = out.find((x) => x.dow === launch.dow);
    if (!known) out.push({ dow: launch.dow, name: launch.water || launch.name, county: '', lat: launch.lat, lng: launch.lng });
    else if (known.lat == null || known.lng == null) Object.assign(known, { lat: launch.lat, lng: launch.lng });
  }
  return out;
}

/** Default fishing lakes: the one the nearest launch goes into, else the first nearby lake. */
export function defaultLakes(lakes: NearbyLake[], launches: BoatLaunchSite[]): string[] {
  const viaLaunch = launches.find((l) => l.dow)?.dow;
  if (viaLaunch) return [viaLaunch];
  return lakes[0] ? [lakes[0].dow] : [];
}

export interface LakeRow {
  lake: NearbyLake;
  /** From the origin (the trip's launch, else its location); null when the lake's position isn't known. */
  distanceKm: number | null;
  launches: BoatLaunchSite[];
}

/**
 * Lakes around a point, nearest first: distance to the lake's closest public
 * launch (or its LakeFinder point), with its launches. Lakes without a known
 * position are listed last.
 */
export function lakeRows(lakes: NearbyLake[], launches: BoatLaunchSite[], origin: { lat: number; lng: number }, maxKm: number): LakeRow[] {
  const rows: LakeRow[] = lakes.map((lake) => {
    const own = launches.filter((l) => l.dow === lake.dow).map((l) => ({ ...l, distanceKm: Math.round(distanceKm(origin, l) * 10) / 10 }));
    own.sort((a, b) => a.distanceKm - b.distanceKm);
    const candidates = [...own.map((l) => l.distanceKm)];
    if (lake.lat != null && lake.lng != null) candidates.push(distanceKm(origin, { lat: lake.lat, lng: lake.lng }));
    const d = candidates.length ? Math.min(...candidates) : null;
    return { lake, distanceKm: d === null ? null : Math.round(d * 10) / 10, launches: own };
  });
  return rows
    .filter((r) => r.distanceKm === null || r.distanceKm <= maxKm)
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.lake.name.localeCompare(b.lake.name));
}

/** Rough South Dakota test (the MN border runs near 96.45° W). */
export const inSouthDakota = (p: { lat: number; lng: number }) => p.lat >= 42.4 && p.lat <= 45.95 && p.lng >= -104.1 && p.lng <= -96.44;

export const SD_FISHERY_REPORTS = 'https://apps.sd.gov/GF56FisheriesReports/';

export interface WaterRow {
  water: string;
  distanceKm: number;
  launches: BoatLaunchSite[];
}

/**
 * South Dakota lake list: named lakes from open map data plus any waters that
 * launches name, each with the ramps on it, nearest first.
 */
export function sdWaterRows(
  waters: NamedWater[],
  launches: BoatLaunchSite[],
  origin: { lat: number; lng: number },
  maxKm: number,
): WaterRow[] {
  const rows = new Map<string, WaterRow>();
  for (const w of waters) {
    const d = Math.round(distanceToWater(origin, w) * 10) / 10;
    const key = w.name.toLowerCase();
    if (!rows.has(key) || rows.get(key)!.distanceKm > d) rows.set(key, { water: w.name, distanceKm: d, launches: [] });
  }
  for (const l of launches) {
    if (l.dow || !l.water) continue;
    const key = l.water.trim().toLowerCase();
    const dl = Math.round(distanceKm(origin, l) * 10) / 10;
    const row = rows.get(key) ?? { water: l.water.trim(), distanceKm: dl, launches: [] };
    row.launches.push({ ...l, distanceKm: dl });
    row.distanceKm = Math.min(row.distanceKm, dl);
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, launches: r.launches.sort((a, b) => a.distanceKm - b.distanceKm) }))
    .filter((r) => r.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || b.launches.length - a.launches.length);
}

/** The trip's launch only counts if it's a real spot near the trip (not an empty 0,0 or one left over from another campground). */
export function usableLaunch<T extends { lat: number; lng: number }>(launch: T | null | undefined, near: { lat: number; lng: number }, maxKm = 40): T | null {
  if (!launch || (launch.lat === 0 && launch.lng === 0)) return null;
  return distanceKm(launch, near) <= maxKm ? launch : null;
}
