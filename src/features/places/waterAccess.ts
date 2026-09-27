import type { BoatLaunchSite } from '../../model/schemas';
import { bboxAround, distanceKm, errText, featurePoint, getJson, listLayers, pick, queryLayer, type EsriFeature, type EsriLayer } from './arcgis';

/**
 * DNR "Public Water Access Sites in Minnesota" (MN Geospatial Commons dataset
 * struc-water-access-sites): DNR launches plus free public launches run by
 * others. Layer "Water Access Sites", points, display field access_name.
 * The older loc_ name is kept as a fallback.
 */
export const WATER_ACCESS_SERVICES: [string, string][] = [
  ['https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_water_access_sites/FeatureServer', 'DNR public water accesses'],
  ['https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/struc_water_access_sites/MapServer', 'DNR public water accesses (map service)'],
  ['https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/loc_water_access_sites/FeatureServer', 'DNR water accesses (older address)'],
];
/**
 * South Dakota GFP's own GIS server. Its public water access / boat ramp layer
 * isn't documented, so it's found by name in these folders at run time.
 */
export const SD_GFP_SERVER = 'https://gfpgis.sd.gov/arcgis/rest/services';
export const SD_GFP_FOLDERS = ['Parks', 'Fisheries', 'Public_Lands'];
const SD_LABEL = 'SD GFP boat ramps';

/** Report lines start with one of these when a current source was used. */
export const PRIMARY_LAUNCH_SOURCE = WATER_ACCESS_SERVICES[0]![1];
export const CURRENT_LAUNCH_SOURCES = [...WATER_ACCESS_SERVICES.map(([, l]) => l), SD_LABEL];

type Box = [number, number, number, number]; // [west, south, east, north]
const MN_BOX: Box = [-97.3, 43.4, -89.4, 49.4];
const SD_BOX: Box = [-104.1, 42.4, -96.4, 46];
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Launches listed as "nearby" (the rest feed the lakes list, out to 25 miles). */
export const LAUNCH_SEARCH_KM = 10;
export const LAUNCH_FETCH_KM = 40.2;

const NAME = [/^(fac|facility|site|access|was)_?name$/i, /^name$/i, /^(?!.*(lake|water|county|admin|unit|owner|manag)).*name/i];
const WATER = [/^(lake|water|waterbody|water_body|resource)_?name$/i, /^(?!.*(id|num|dow|type|class)).*(lake|water|resource)/i];
const RAMP = [/ramp/i, /launch/i, /surface/i, /carry/i];
const MANAGER = [/admin/i, /manag/i, /owner/i, /agency/i, /unit_?type/i];

function dowIn(attrs: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(attrs)) {
    if (!/dow|lake_?id|lakeid|basin|wb_?id/i.test(k) || v === null || v === undefined) continue;
    const digits = String(v).replace(/\D/g, '');
    if (digits.length === 8) return digits;
    if (digits.length === 6) return `${digits}00`; // basin id without the sub-basin suffix
  }
  return null;
}

export function parseLaunches(features: EsriFeature[], from: { lat: number; lng: number }, maxKm = LAUNCH_SEARCH_KM, mnLakeIds = true): BoatLaunchSite[] {
  const out: BoatLaunchSite[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = featurePoint(f);
    if (!p) continue;
    const a = f.attributes ?? {};
    const d = distanceKm(from, p);
    if (d > maxKm) continue;
    const name = pick(a, NAME) || 'Public water access';
    const key = `${name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      water: pick(a, WATER),
      // DOW lake numbers are Minnesota's; another state's ids mean something else.
      dow: mnLakeIds ? dowIn(a) : null,
      ramp: pick(a, RAMP),
      manager: pick(a, MANAGER),
      lat: p.lat,
      lng: p.lng,
      distanceKm: Math.round(d * 10) / 10,
    });
  }
  return out.sort((x, y) => x.distanceKm - y.distanceKm);
}

function pointLayer(layers: EsriLayer[]): EsriLayer | undefined {
  return (
    layers.find((l) => /point/i.test(l.geometryType ?? '') && /access|launch|was/i.test(l.name)) ??
    layers.find((l) => /point/i.test(l.geometryType ?? '')) ??
    layers[0]
  );
}

async function findMnLaunches(at: { lat: number; lng: number }, fetchFn: typeof fetch, km: number): Promise<{ launches: BoatLaunchSite[]; report: string[] }> {
  const report: string[] = [];
  for (const [service, label] of WATER_ACCESS_SERVICES) {
    try {
      const layer = pointLayer(await listLayers(service, fetchFn));
      if (!layer) {
        report.push(`${label}: no layers`);
        continue;
      }
      const features = await queryLayer(`${service}/${layer.id}`, { bbox: bboxAround(at.lat, at.lng, km), max: 1000 }, fetchFn);
      const launches = parseLaunches(features, at, km);
      report.push(`${label}: ${launches.length} within ${Math.round(km * 0.621371)} mi`);
      return { launches, report };
    } catch (e) {
      report.push(`${label}: ${errText(e)}`);
    }
  }
  return { launches: [], report };
}

let sdLayerCache: Promise<{ url: string; name: string } | null> | null = null;

/** Find GFP's boat ramp / water access point layer by name. */
export async function discoverSdAccessLayer(fetchFn: typeof fetch): Promise<{ url: string; name: string } | null> {
  const services: { name: string; type: string }[] = [];
  for (const folder of SD_GFP_FOLDERS) {
    try {
      const data = (await getJson(`${SD_GFP_SERVER}/${folder}?f=json`, fetchFn)) as { services?: { name: string; type: string }[] };
      services.push(...(data.services ?? []).filter((x) => /^(FeatureServer|MapServer)$/.test(x.type)));
    } catch {
      /* folder not public — try the next */
    }
  }
  const likely = /ramp|access|boat|pwa|launch|fishing/i;
  const ordered = [...services.filter((x) => likely.test(x.name)), ...services.filter((x) => !likely.test(x.name))].slice(0, 8);
  for (const svc of ordered) {
    const base = `${SD_GFP_SERVER}/${svc.name}/${svc.type}`;
    try {
      const layer = (await listLayers(base, fetchFn)).find((l) => /ramp|water access|boat access|launch/i.test(l.name) && /point/i.test(l.geometryType ?? 'point'));
      if (layer) return { url: `${base}/${layer.id}`, name: `${svc.name} › ${layer.name}` };
    } catch {
      /* next service */
    }
  }
  return null;
}

async function findSdLaunches(at: { lat: number; lng: number }, fetchFn: typeof fetch, km: number): Promise<{ launches: BoatLaunchSite[]; report: string[] }> {
  sdLayerCache ??= discoverSdAccessLayer(fetchFn).catch(() => null);
  const layer = await sdLayerCache;
  if (!layer) {
    sdLayerCache = null;
    return { launches: [], report: [`${SD_LABEL}: no boat ramp layer found on GFP’s map server`] };
  }
  try {
    const features = await queryLayer(layer.url, { bbox: bboxAround(at.lat, at.lng, km), max: 1000 }, fetchFn);
    const launches = parseLaunches(features, at, km, false);
    return { launches, report: [`${SD_LABEL}: ${launches.length} within ${Math.round(km * 0.621371)} mi (${layer.name})`] };
  } catch (e) {
    return { launches: [], report: [`${SD_LABEL}: ${errText(e)}`] };
  }
}

/** Public boat launches within `km` of a point, nearest first (Minnesota and/or South Dakota), plus a line per source tried. */
export async function findBoatLaunches(
  at: { lat: number; lng: number },
  fetchFn: typeof fetch,
  km = LAUNCH_FETCH_KM,
): Promise<{ launches: BoatLaunchSite[]; report: string[] }> {
  const b = bboxAround(at.lat, at.lng, km);
  const parts: Promise<{ launches: BoatLaunchSite[]; report: string[] }>[] = [];
  if (overlaps(b, MN_BOX)) parts.push(findMnLaunches(at, fetchFn, km));
  if (overlaps(b, SD_BOX)) parts.push(findSdLaunches(at, fetchFn, km));
  if (!parts.length) return { launches: [], report: ['Boat launches: only Minnesota and South Dakota data is set up'] };
  const results = await Promise.all(parts);
  return {
    launches: results.flatMap((r) => r.launches).sort((x, y) => x.distanceKm - y.distanceKm),
    report: results.flatMap((r) => r.report),
  };
}
