/**
 * Offline-tile math: slippy-map tile coordinates, region tile/byte
 * estimates, and the capped zoom levels we allow. See docs/phase-4.md for
 * the tile-policy decision this supports — we deliberately do NOT build a
 * scripted bulk tile downloader. This module only estimates how many tiles
 * a "prepare offline" viewing pass will touch, and helps keep it capped;
 * the actual caching happens by the Workbox runtime cache as MapLibre
 * requests tiles while the map is driven across the trip area (see
 * `offline.ts`).
 */

export type BBox = readonly [west: number, south: number, east: number, north: number];

/** A trip area padded a bit so nearby routes/pins aren't right at the edge. */
export function bboxFromPoints(points: readonly { lat: number; lng: number }[], padDeg = 0.03): BBox | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return [west - padDeg, south - padDeg, east + padDeg, north + padDeg];
}

export function mergeBBoxes(boxes: readonly (BBox | null)[]): BBox | null {
  const real = boxes.filter((b): b is BBox => b !== null);
  if (real.length === 0) return null;
  let [west, south, east, north] = real[0] as [number, number, number, number];
  for (const b of real.slice(1)) {
    west = Math.min(west, b[0]);
    south = Math.min(south, b[1]);
    east = Math.max(east, b[2]);
    north = Math.max(north, b[3]);
  }
  return [west, south, east, north];
}

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z);
}

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}

interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function tileRangeForBbox(bbox: BBox, z: number): TileRange {
  const [west, south, east, north] = bbox;
  const maxTile = 2 ** z - 1;
  const clamp = (n: number) => Math.max(0, Math.min(maxTile, n));
  const xMin = clamp(lngToTileX(west, z));
  const xMax = clamp(lngToTileX(east, z));
  // Latitude increases north but tile Y increases south, so north -> smaller y.
  const yMin = clamp(latToTileY(Math.min(85.05, north), z));
  const yMax = clamp(latToTileY(Math.max(-85.05, south), z));
  return { xMin, xMax, yMin, yMax };
}

/**
 * How many tiles intersect a bbox at one zoom — cheap arithmetic, no array,
 * so it's safe to call for a huge (even world-sized) bbox when estimating.
 */
export function tileCountForBbox(bbox: BBox, z: number): number {
  const { xMin, xMax, yMin, yMax } = tileRangeForBbox(bbox, z);
  return Math.max(0, xMax - xMin + 1) * Math.max(0, yMax - yMin + 1);
}

/**
 * Every tile that intersects a lng/lat bbox at one zoom level (standard
 * slippy-map / Web Mercator grid). Only call this once a region is already
 * known to be small (e.g. after `clampZoomsToBudget`) — for an estimate use
 * `tileCountForBbox` instead, which never materializes the list.
 */
export function tilesForBbox(bbox: BBox, z: number): TileCoord[] {
  const { xMin, xMax, yMin, yMax } = tileRangeForBbox(bbox, z);
  const tiles: TileCoord[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({ x, y, z });
    }
  }
  return tiles;
}

export interface RegionEstimate {
  perZoom: { z: number; count: number }[];
  totalTiles: number;
  /** Rough, labeled estimate — real tile sizes vary a lot (vector vs. raster, sparse vs. dense). */
  estBytes: number;
}

/** Average vector-tile size on this style is small; this is a conservative round-number estimate, not a measurement. */
export const AVG_TILE_BYTES = 20_000;

export function estimateRegion(bbox: BBox, zooms: readonly number[], avgTileBytes = AVG_TILE_BYTES): RegionEstimate {
  const perZoom = zooms.map((z) => ({ z, count: tileCountForBbox(bbox, z) }));
  const totalTiles = perZoom.reduce((s, p) => s + p.count, 0);
  return { perZoom, totalTiles, estBytes: totalTiles * avgTileBytes };
}

/** Keep "prepare offline" small and considerate of the shared free tile server: capped zooms, hard tile ceiling. */
export const OFFLINE_ZOOM_LEVELS: readonly number[] = [11, 13, 14];
export const MAX_OFFLINE_TILES = 1500;

/**
 * Drops zoom levels (highest-detail first) until the region fits under
 * `maxTiles`, so a big trip area can't accidentally trigger a huge fetch.
 */
export function clampZoomsToBudget(bbox: BBox, zooms: readonly number[], maxTiles = MAX_OFFLINE_TILES): RegionEstimate & { zooms: number[] } {
  const sorted = [...zooms].sort((a, b) => a - b);
  let kept = [...sorted];
  let estimate = estimateRegion(bbox, kept);
  while (estimate.totalTiles > maxTiles && kept.length > 1) {
    kept = kept.slice(0, -1); // drop the highest (most detailed, most numerous) zoom first
    estimate = estimateRegion(bbox, kept);
  }
  return { ...estimate, zooms: kept };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

/**
 * A short list of camera stops (`{ lng, lat, zoom }`) that together sweep a
 * bbox at one zoom level, for driving a real MapLibre camera so tiles are
 * cached "by viewing" rather than fetched in bulk directly. `viewportTiles`
 * is roughly how many tiles wide/tall one stop's viewport covers.
 */
export interface CameraStop {
  lng: number;
  lat: number;
  zoom: number;
}

export function viewportStops(bbox: BBox, zoom: number, viewportTiles = 4): CameraStop[] {
  const [west, south, east, north] = bbox;
  const spanTiles = 2 ** zoom;
  const tileDegLng = 360 / spanTiles;
  const stepDegLng = tileDegLng * Math.max(1, viewportTiles);

  const stops: CameraStop[] = [];
  // Longitude steps are even in degrees; latitude steps approximate the same
  // ground distance using cos(lat) so stops near the top/bottom of a tall
  // bbox aren't spaced much further apart in tiles than ones near its middle.
  const midLat = (north + south) / 2;
  const stepDegLat = stepDegLng * Math.max(0.2, Math.cos((midLat * Math.PI) / 180));

  for (let lat = south; lat <= north + 1e-9; lat += stepDegLat) {
    for (let lng = west; lng <= east + 1e-9; lng += stepDegLng) {
      stops.push({ lng: Math.min(lng, east), lat: Math.min(lat, north), zoom });
    }
  }
  return stops.length > 0 ? stops : [{ lng: (west + east) / 2, lat: midLat, zoom }];
}
