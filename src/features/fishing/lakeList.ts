import type { BoatLaunchSite, NearbyLake } from '../../model/schemas';
import { distanceKm } from '../places/arcgis';

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
