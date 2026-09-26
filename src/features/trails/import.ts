/**
 * Pure conversion from a parsed GeoJSON FeatureCollection (whatever produced
 * it — `@tmcw/togeojson`, in the real app) into draft `route:*`/`pin:*`
 * records. Kept free of `DOMParser`/`@tmcw/togeojson` so it can be unit
 * tested in a plain Node environment with hand-built fixtures; see
 * `gpxKml.ts` for the thin browser adapter that feeds it.
 */
import {
  DEFAULT_AVG_MPH,
  estimateDriveTimeMin,
  lineDistanceMi,
  simplifyMultiToByteBudget,
  simplifyToByteBudget,
} from './geo';
import type { Route } from '../../model/trails';

/** Sync limit is 256 KB per record; leave generous headroom for the rest of the fields. */
export const MAX_ROUTE_RECORD_BYTES = 140_000;

export type RouteGeometry = Route['geometry'];

export interface RouteDraft {
  name: string;
  geometry: RouteGeometry;
  distanceMi: number;
  estDriveMin: number | null;
  /** Point counts before/after simplification, shown to the owner for transparency. */
  originalPoints: number;
  keptPoints: number;
}

export interface PinDraft {
  name: string;
  position: { lat: number; lng: number };
}

export interface ImportIssue {
  message: string;
}

export interface ImportResult {
  routes: RouteDraft[];
  pins: PinDraft[];
  issues: ImportIssue[];
}

export interface ImportOptions {
  /** Average forest-road speed used for the drive-time estimate (mph). */
  avgMph?: number;
  /** Per-route record size budget in bytes (post-simplification). */
  maxRouteBytes?: number;
}

/** Minimal shape we need from a GeoJSON Feature/FeatureCollection — avoids a hard `geojson` type dependency here. */
export interface MinimalGeometry {
  type: string;
  coordinates: unknown;
}
export interface MinimalFeature {
  type: 'Feature';
  properties?: Record<string, unknown> | null;
  geometry?: MinimalGeometry | null;
}
export interface MinimalFeatureCollection {
  type: 'FeatureCollection';
  features: MinimalFeature[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function featureName(f: MinimalFeature, fallback: string): string {
  const raw = f.properties?.name ?? f.properties?.title;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return fallback;
}

/** Defends against malformed/extra coordinate members (e.g. a stray 4th value). */
function cleanPosition(p: unknown): number[] | null {
  if (!Array.isArray(p) || p.length < 2) return null;
  const lng = Number(p[0]);
  const lat = Number(p[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const ele = p.length > 2 ? Number(p[2]) : undefined;
  return ele !== undefined && Number.isFinite(ele) ? [lng, lat, ele] : [lng, lat];
}

function cleanLine(coords: unknown): number[][] {
  if (!Array.isArray(coords)) return [];
  const out: number[][] = [];
  for (const p of coords) {
    const c = cleanPosition(p);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Turns whatever `@tmcw/togeojson` (or a hand-built fixture) produced into
 * route/pin drafts. Unsupported geometry types (polygons, etc.) are skipped
 * with an issue rather than thrown.
 */
export function featureCollectionToDrafts(fc: MinimalFeatureCollection | null | undefined, opts: ImportOptions = {}): ImportResult {
  const avgMph = opts.avgMph ?? DEFAULT_AVG_MPH;
  const maxRouteBytes = opts.maxRouteBytes ?? MAX_ROUTE_RECORD_BYTES;

  const routes: RouteDraft[] = [];
  const pins: PinDraft[] = [];
  const issues: ImportIssue[] = [];

  const features = fc?.features ?? [];
  if (features.length === 0) {
    issues.push({ message: 'No tracks, routes or points were found in this file.' });
    return { routes, pins, issues };
  }

  let routeCount = 0;
  let pinCount = 0;

  for (const f of features) {
    const geom = f.geometry;
    if (!geom) {
      issues.push({ message: `Skipped "${featureName(f, 'feature')}": no geometry.` });
      continue;
    }

    if (geom.type === 'Point') {
      const p = cleanPosition(geom.coordinates);
      if (!p) {
        issues.push({ message: `Skipped "${featureName(f, 'point')}": invalid coordinates.` });
        continue;
      }
      pinCount++;
      pins.push({ name: featureName(f, `Imported point ${pinCount}`), position: { lng: p[0] ?? 0, lat: p[1] ?? 0 } });
      continue;
    }

    if (geom.type === 'LineString') {
      const coords = cleanLine(geom.coordinates);
      if (coords.length < 2) {
        issues.push({ message: `Skipped "${featureName(f, 'route')}": fewer than 2 usable points.` });
        continue;
      }
      routeCount++;
      const simplified = simplifyToByteBudget(coords, maxRouteBytes);
      const distanceMi = lineDistanceMi(simplified);
      routes.push({
        name: featureName(f, `Imported route ${routeCount}`),
        geometry: { type: 'LineString', coordinates: simplified },
        distanceMi: round2(distanceMi),
        estDriveMin: estimateDriveTimeMin(distanceMi, avgMph),
        originalPoints: coords.length,
        keptPoints: simplified.length,
      });
      continue;
    }

    if (geom.type === 'MultiLineString') {
      const rawParts = Array.isArray(geom.coordinates) ? geom.coordinates : [];
      const parts = rawParts.map((part) => cleanLine(part)).filter((part) => part.length >= 2);
      if (parts.length === 0) {
        issues.push({ message: `Skipped "${featureName(f, 'route')}": no usable segments.` });
        continue;
      }
      routeCount++;
      const simplifiedParts = simplifyMultiToByteBudget(parts, maxRouteBytes);
      const distanceMi = simplifiedParts.reduce((sum, part) => sum + lineDistanceMi(part), 0);
      routes.push({
        name: featureName(f, `Imported route ${routeCount}`),
        geometry: { type: 'MultiLineString', coordinates: simplifiedParts },
        distanceMi: round2(distanceMi),
        estDriveMin: estimateDriveTimeMin(distanceMi, avgMph),
        originalPoints: parts.reduce((sum, part) => sum + part.length, 0),
        keptPoints: simplifiedParts.reduce((sum, part) => sum + part.length, 0),
      });
      continue;
    }

    issues.push({ message: `Skipped "${featureName(f, geom.type)}": unsupported geometry type "${geom.type}".` });
  }

  return { routes, pins, issues };
}
