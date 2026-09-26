/**
 * Pure geometry helpers for imported tracks: distance, drive-time estimate,
 * and our own Douglas–Peucker simplification (no mapping-library dependency,
 * so a route record stays well under the 256 KB sync limit).
 *
 * Coordinates are GeoJSON `[lng, lat]` or `[lng, lat, ele]` pairs throughout.
 */

/** Forest roads are slow and winding; this is a labeled estimate, not a fact. */
export const DEFAULT_AVG_MPH = 15;

const EARTH_RADIUS_MI = 3958.7613;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two `[lng, lat, ...]` points, in miles. */
export function haversineMiles(a: readonly number[], b: readonly number[]): number {
  const lng1 = a[0] ?? 0;
  const lat1 = a[1] ?? 0;
  const lng2 = b[0] ?? 0;
  const lat2 = b[1] ?? 0;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a line (sum of consecutive-point haversine distances), in miles. */
export function lineDistanceMi(coords: readonly (readonly number[])[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    if (prev && cur) total += haversineMiles(prev, cur);
  }
  return total;
}

/** Total length of a MultiLineString (sum over every part), in miles. */
export function multiLineDistanceMi(parts: readonly (readonly (readonly number[])[])[]): number {
  return parts.reduce((sum, part) => sum + lineDistanceMi(part), 0);
}

/** Labeled estimate only — the owner sets the average speed per forest-road conditions. */
export function estimateDriveTimeMin(distanceMi: number, avgMph: number): number | null {
  if (!(avgMph > 0) || !(distanceMi >= 0)) return null;
  return Math.round((distanceMi / avgMph) * 60);
}

/**
 * Ramer–Douglas–Peucker line simplification, iterative (no recursion, so very
 * long GPX tracks can't blow the stack). Distance is measured on a local
 * equirectangular projection scaled by cos(latitude) so degrees-of-longitude
 * aren't over-weighted away from the equator; `toleranceMi` is then converted
 * using ~69 miles per degree of latitude.
 */
export function simplifyDouglasPeucker(points: readonly (readonly number[])[], toleranceMi: number): number[][] {
  if (points.length <= 2 || toleranceMi <= 0) return points.map((p) => p.slice());

  const mid = points[Math.floor(points.length / 2)];
  const refLatDeg = mid ? (mid[1] ?? 0) : 0;
  const scaleLng = Math.cos(toRad(refLatDeg)) || 1;
  const toleranceDeg = toleranceMi / 69.0;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const project = (p: readonly number[]): [number, number] => [(p[0] ?? 0) * scaleLng, p[1] ?? 0];

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) continue;
    const [start, end] = range;
    if (end <= start + 1) continue;

    const startPt = points[start];
    const endPt = points[end];
    if (!startPt || !endPt) continue;
    const [sx, sy] = project(startPt);
    const [ex, ey] = project(endPt);
    const dx = ex - sx;
    const dy = ey - sy;
    const segLenSq = dx * dx + dy * dy;

    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const pt = points[i];
      if (!pt) continue;
      const [px, py] = project(pt);
      let dist: number;
      if (segLenSq === 0) {
        dist = Math.hypot(px - sx, py - sy);
      } else {
        const t = ((px - sx) * dx + (py - sy) * dy) / segLenSq;
        const tc = Math.max(0, Math.min(1, t));
        dist = Math.hypot(px - (sx + tc * dx), py - (sy + tc * dy));
      }
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxIdx !== -1 && maxDist > toleranceDeg) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const out: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      const p = points[i];
      if (p) out.push(p.slice());
    }
  }
  return out;
}

/**
 * Simplifies a single line until its rough JSON size fits `maxBytes`,
 * growing the tolerance geometrically. `JSON.stringify(...).length` is a
 * reasonable stand-in for bytes here (coordinates are ASCII digits/`.`/`-`).
 */
export function simplifyToByteBudget(coords: readonly (readonly number[])[], maxBytes: number): number[][] {
  let tolerance = 0.002; // miles
  let out = coords.map((p) => p.slice());
  for (let i = 0; i < 25; i++) {
    if (JSON.stringify(out).length <= maxBytes || out.length <= 2) return out;
    out = simplifyDouglasPeucker(coords, tolerance);
    tolerance *= 1.7;
  }
  return out;
}

/** Same idea, applied uniformly across every part of a MultiLineString. */
export function simplifyMultiToByteBudget(
  parts: readonly (readonly (readonly number[])[])[],
  maxBytes: number,
): number[][][] {
  let tolerance = 0.002;
  let out: number[][][] = parts.map((p) => p.map((pt) => pt.slice()));
  const minPoints = parts.length * 2;
  for (let i = 0; i < 25; i++) {
    const totalPoints = out.reduce((s, p) => s + p.length, 0);
    if (JSON.stringify(out).length <= maxBytes || totalPoints <= minPoints) return out;
    out = parts.map((part) => simplifyDouglasPeucker(part, tolerance));
    tolerance *= 1.7;
  }
  return out;
}
