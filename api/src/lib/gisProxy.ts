/**
 * Server-side fetch of official Minnesota / South Dakota / USFS map and lake data for the app.
 * The DNR's servers don't send CORS headers, so a phone can't read them
 * directly; the API fetches on its behalf. Strict allowlist of read-only
 * requests: ArcGIS "layers"/"query" (JSON only) and DNR LakeFinder lookups.
 */
const ARCGIS: RegExp[] = [
  // ArcGIS catalog item lookup (to find where an official dataset is served).
  /^https:\/\/www\.arcgis\.com\/sharing\/rest\/content\/items\/[0-9a-f]{32}$/,
  // ArcGIS-hosted services and the State of Minnesota's GIS hosting.
  /^https:\/\/services\d*\.arcgis\.com\/[\w]+\/arcgis\/rest\/services\/[\w/]+\/(FeatureServer|MapServer)\/(layers|\d+\/query)$/,
  /^https:\/\/enterprise\.gisdata\.mn\.gov\/aghost\/rest\/services\/[\w/]+\/(FeatureServer|MapServer)\/(layers|\d+\/query)$/,
  /^https?:\/\/arcgis\.dnr\.state\.mn\.us\/(host|mndnr|public)\/rest\/services\/[\w/]+\/(FeatureServer|MapServer)\/(layers|\d+\/query)$/,
  /^https:\/\/(gis|arcgis)\.metc\.state\.mn\.us\/arcgis\/rest\/services\/[\w/]+\/(FeatureServer|MapServer)\/(layers|\d+\/query)$/,
  // USFS enterprise data warehouse (recreation sites: campground locations).
  /^https:\/\/apps\.fs\.usda\.gov\/arcx\/rest\/services\/EDW\/[\w]+\/MapServer\/(layers|\d+\/query)$/,
  // South Dakota GFP (boat ramps): a few folder listings to find the layer, then layers/query.
  /^https:\/\/gfpgis\.sd\.gov\/arcgis\/rest\/services\/(Parks|Fisheries|Public_Lands)$/,
  /^https:\/\/gfpgis\.sd\.gov\/arcgis\/rest\/services\/[\w/]+\/(FeatureServer|MapServer)\/(layers|\d+\/query)$/,
];

/** DNR LakeFinder: a lake's fish surveys by DOW number, and lakes near a point / by name. */
const LAKEFINDER: { re: RegExp; ok: (q: URLSearchParams) => boolean }[] = [
  {
    re: /^https:\/\/maps\d?\.dnr\.state\.mn\.us\/cgi-bin\/lakefinder\/detail\.cgi$/,
    ok: (q) => q.get('type') === 'lake_survey' && /^\d{8}$/.test(q.get('id') ?? ''),
  },
  {
    re: /^https?:\/\/services\.dnr\.state\.mn\.us\/api\/lakefinder\/by_point\/v1\/?$/,
    ok: (q) => [q.get('lat'), q.get('lon')].every((v) => v !== null && /^-?\d{1,3}(\.\d+)?$/.test(v)),
  },
  {
    re: /^https?:\/\/services\.dnr\.state\.mn\.us\/api\/lakefinder\/by_name\/v1\/?$/,
    ok: (q) => /^[\w .'-]{2,60}$/.test(q.get('name') ?? ''),
  },
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
  if (ARCGIS.some((re) => re.test(base))) return u.searchParams.get('f') === 'json' ? u : null; // JSON only
  const lake = LAKEFINDER.find((r) => r.re.test(base));
  return lake && lake.ok(u.searchParams) ? u : null;
}
