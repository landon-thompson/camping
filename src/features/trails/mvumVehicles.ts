import { MVUM_LAYER_IDS, MVUM_SERVICE_URL } from './mvum';

/**
 * Color MVUM roads/trails by what may legally drive them, from the Forest
 * Service's own attributes (fetched for the visible area). The printed MVUM
 * stays the legal reference.
 */
export type VehicleClass = 'all' | 'high-clearance' | 'ohv' | 'other';

export const VEHICLE_CLASS_STYLE: Record<VehicleClass, { color: string; label: string; note: string }> = {
  all: { color: '#1d8a3a', label: 'All vehicles', note: 'Passenger cars OK' },
  'high-clearance': { color: '#d9822b', label: 'High-clearance only', note: 'GX550 OK; rough, likely no trailer turnaround' },
  ohv: { color: '#c0322b', label: 'ATV / motorcycle / OHV only', note: 'Not legal for the GX' },
  other: { color: '#7a7f85', label: 'Other or unknown', note: 'Tap with Road info for details' },
};

/** Vector lines replace the official picture from this zoom in. */
export const MVUM_VECTOR_MIN_ZOOM = 9;

function isOpen(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s || /^(null|n\/?a|no|n|closed|false|0)$/i.test(s)) return false;
  return true; // "open", "yes", or a date range such as "05/15-11/30"
}

function anyOpen(props: Record<string, unknown>, pattern: RegExp): boolean {
  return Object.entries(props).some(([k, v]) => pattern.test(k) && isOpen(v));
}

export function classifyVehicles(props: Record<string, unknown>): { cls: VehicleClass; seasonal: boolean } {
  let cls: VehicleClass = 'other';
  if (anyOpen(props, /passenger/i)) cls = 'all';
  else if (anyOpen(props, /high.?clearance/i)) cls = 'high-clearance';
  else if (anyOpen(props, /\batv|motorcycle|ohv|offhighway|off_highway/i)) cls = 'ohv';
  const seasonalField = Object.entries(props).find(([k]) => /^seasonal$/i.test(k))?.[1];
  const seasonal =
    (typeof seasonalField === 'string' && /seasonal/i.test(seasonalField)) ||
    Object.entries(props).some(([k, v]) => /datesopen/i.test(k) && typeof v === 'string' && /\d/.test(v));
  return { cls, seasonal };
}

interface EsriLineFeature {
  attributes?: Record<string, unknown>;
  geometry?: { paths?: number[][][] };
}

export interface MvumLineCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { cls: VehicleClass; seasonal: boolean; name: string };
    geometry: { type: 'MultiLineString'; coordinates: number[][][] };
  }[];
}

export function esriLinesToGeoJSON(features: EsriLineFeature[]): MvumLineCollection {
  const out: MvumLineCollection = { type: 'FeatureCollection', features: [] };
  for (const f of features) {
    const paths = f.geometry?.paths;
    if (!paths?.length) continue;
    const props = f.attributes ?? {};
    const { cls, seasonal } = classifyVehicles(props);
    const nameKey = Object.keys(props).find((k) => /^(name|id)$/i.test(k));
    out.features.push({
      type: 'Feature',
      properties: { cls, seasonal, name: nameKey ? String(props[nameKey] ?? '') : '' },
      geometry: { type: 'MultiLineString', coordinates: paths },
    });
  }
  return out;
}

/** Fetch MVUM roads + trails intersecting a lon/lat box, simplified for the zoom level. */
export async function fetchMvumLines(
  bbox: [number, number, number, number],
  zoom: number,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<MvumLineCollection> {
  const degPerPx = 360 / (256 * 2 ** zoom);
  const params = new URLSearchParams({
    geometry: bbox.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(degPerPx),
    f: 'json',
  });
  const results = await Promise.all(
    [MVUM_LAYER_IDS.roads, MVUM_LAYER_IDS.trails].map(async (id) => {
      const res = await fetchFn(`${MVUM_SERVICE_URL}/${id}/query?${params}`, { signal });
      if (!res.ok) throw new Error(`MVUM ${res.status}`);
      const data = (await res.json()) as { features?: EsriLineFeature[]; error?: unknown };
      if (data.error) throw new Error('MVUM service error');
      return data.features ?? [];
    }),
  );
  return esriLinesToGeoJSON(results.flat());
}
