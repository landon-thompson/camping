import { httpError } from '../reservations/stateParks';

/** Small helpers for reading official ArcGIS map services (DNR, USFS). */

export interface EsriField {
  name: string;
  type?: string;
}
export interface EsriLayer {
  id: number;
  name: string;
  geometryType?: string;
  fields?: EsriField[];
}
export type Attrs = Record<string, unknown>;
export interface EsriFeature {
  attributes?: Attrs;
  geometry?: { x?: number; y?: number } | null;
}

export async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url);
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as { error?: { code?: number; message?: string } };
  if (data && typeof data === 'object' && data.error) {
    throw new Error(`service error ${data.error.code ?? ''} ${data.error.message ?? ''}`.trim());
  }
  return data;
}

export async function listLayers(service: string, fetchFn: typeof fetch): Promise<EsriLayer[]> {
  const data = (await getJson(`${service}/layers?f=json`, fetchFn)) as { layers?: EsriLayer[] };
  return data.layers ?? [];
}

/** Bounding box [west, south, east, north] around a point, `km` each way. */
export function bboxAround(lat: number, lng: number, km: number): [number, number, number, number] {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/** Query a layer, answers in lon/lat. */
export async function queryLayer(
  layerUrl: string,
  opts: { bbox?: [number, number, number, number]; where?: string },
  fetchFn: typeof fetch,
): Promise<EsriFeature[]> {
  const p = new URLSearchParams({
    where: opts.where ?? '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '200',
    f: 'json',
  });
  if (opts.bbox) {
    p.set('geometry', opts.bbox.join(','));
    p.set('geometryType', 'esriGeometryEnvelope');
    p.set('inSR', '4326');
    p.set('spatialRel', 'esriSpatialRelIntersects');
  }
  const data = (await getJson(`${layerUrl}/query?${p}`, fetchFn)) as { features?: EsriFeature[] };
  return data.features ?? [];
}

/** First attribute whose name matches one of the patterns (in order) and has a value. */
export function pick(attrs: Attrs, patterns: RegExp[]): string {
  const keys = Object.keys(attrs);
  for (const re of patterns) {
    for (const k of keys) {
      const v = attrs[k];
      if (re.test(k) && v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

/** A feature's point in lon/lat: its geometry, or latitude/longitude attributes. */
export function featurePoint(f: EsriFeature): { lat: number; lng: number } | null {
  const g = f.geometry;
  if (g && typeof g.x === 'number' && typeof g.y === 'number' && Math.abs(g.y) <= 90 && Math.abs(g.x) <= 180) return { lat: g.y, lng: g.x };
  const a = f.attributes ?? {};
  const lat = Number(pick(a, [/^lat(itude)?$/i, /latitude/i, /_lat$/i]));
  const lng = Number(pick(a, [/^(lon|lng|long|longitude)$/i, /longitude/i, /_(lon|long)$/i]));
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  return null;
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
