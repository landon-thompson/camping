import { distanceKm } from '../places/arcgis';
import type { ModelManifest } from './types';

type LatLng = { lat: number; lng: number };

/** Closest point of a [west, south, east, north] box to p (fine for half-degree tiles). */
function closestInBox(p: LatLng, [w, s, e, n]: [number, number, number, number]): LatLng {
  return { lat: Math.min(n, Math.max(s, p.lat)), lng: Math.min(e, Math.max(w, p.lng)) };
}

/** Ids of the manifest tiles a circle around `origin` touches (pure; no storage). */
export function tilesFor(origin: LatLng, radiusKm: number, manifest: ModelManifest | null): string[] {
  if (!manifest || !Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lng)) return [];
  const out: string[] = [];
  for (const t of manifest.tiles ?? []) {
    if (!Array.isArray(t.bbox) || t.bbox.length !== 4) continue;
    if (distanceKm(origin, closestInBox(origin, t.bbox)) <= radiusKm) out.push(t.id);
  }
  return out;
}
