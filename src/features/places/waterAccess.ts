import type { BoatLaunchSite } from '../../model/schemas';
import { bboxAround, distanceKm, errText, featurePoint, listLayers, pick, queryLayer, type EsriFeature, type EsriLayer } from './arcgis';

/**
 * DNR "Public Water Access Sites in Minnesota" (MN Geospatial Commons dataset
 * loc-water-access-sites): DNR launches plus free public launches run by
 * others. The service address follows the Commons' naming; unverified from the
 * build sandbox, so both service types are tried and failures are reported.
 */
export const WATER_ACCESS_SERVICES: [string, string][] = [
  ['https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/loc_water_access_sites/FeatureServer', 'DNR water accesses (Commons)'],
  ['https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/loc_water_access_sites/MapServer', 'DNR water accesses (Commons map)'],
];

export const LAUNCH_SEARCH_KM = 10;

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

export function parseLaunches(features: EsriFeature[], from: { lat: number; lng: number }, maxKm = LAUNCH_SEARCH_KM): BoatLaunchSite[] {
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
      dow: dowIn(a),
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

/** Public boat launches within `km` of a point, nearest first, plus a line per source tried. */
export async function findBoatLaunches(
  at: { lat: number; lng: number },
  fetchFn: typeof fetch,
  km = LAUNCH_SEARCH_KM,
): Promise<{ launches: BoatLaunchSite[]; report: string[] }> {
  const report: string[] = [];
  for (const [service, label] of WATER_ACCESS_SERVICES) {
    try {
      const layer = pointLayer(await listLayers(service, fetchFn));
      if (!layer) {
        report.push(`${label}: no layers`);
        continue;
      }
      const features = await queryLayer(`${service}/${layer.id}`, { bbox: bboxAround(at.lat, at.lng, km) }, fetchFn);
      const launches = parseLaunches(features, at, km);
      report.push(`${label}: ${launches.length} within ${km} km`);
      return { launches, report };
    } catch (e) {
      report.push(`${label}: ${errText(e)}`);
    }
  }
  return { launches: [], report };
}
