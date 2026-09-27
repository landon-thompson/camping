/**
 * Server-side fetch of official Minnesota GIS data for the app. The DNR's
 * ArcGIS servers don't send CORS headers, so a phone can't read them
 * directly; the API fetches on its behalf. Strict allowlist: only read-only
 * "layers" and "query" requests to known state map services.
 */
const ALLOWED: RegExp[] = [
  /^https?:\/\/arcgis\.dnr\.state\.mn\.us\/(host|mndnr)\/rest\/services\/[\w/]+\/(FeatureServer|MapServer)\/(layers|\d+\/query)$/,
  /^https:\/\/(gis|arcgis)\.metc\.state\.mn\.us\/arcgis\/rest\/services\/[\w/]+\/(FeatureServer|MapServer)\/(layers|\d+\/query)$/,
];

export const MAX_GIS_BYTES = 8 * 1024 * 1024;

export function allowedGisUrl(raw: string | null): URL | null {
  if (!raw || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password || u.hash) return null;
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  if (!ALLOWED.some((re) => re.test(base))) return null;
  if (u.searchParams.get('f') !== 'json') return null; // JSON only
  return u;
}
