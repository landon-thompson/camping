import type { Campground, LatLng } from '../../model/schemas';
import { fetchParksFromService, normalizeName, REGION_NAME, type ParkPoint, type ParkRegion } from '../reservations/stateParks';
import { errText, featurePoint, listLayers, pick, queryLayer, type EsriFeature } from './arcgis';

/** USFS recreation sites (campgrounds, day-use areas…) with their locations. */
export const USFS_RECREATION_SERVICE = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer';

/** Minnesota and South Dakota, [west, south, east, north] (Superior/Chippewa, Black Hills, Buffalo Gap). */
const SEARCH_BBOX: [number, number, number, number] = [-104.1, 42.4, -89.4, 49.4];

export interface FoundLocation {
  location: LatLng;
  /** Where it came from, shown on the campground and kept in `source`. */
  source: string;
  /** What to check, added to the campground's verify note. */
  verify: string;
}

export type LookupResult = { ok: true; found: FoundLocation } | { ok: false; message: string };

const FILLER = /\b(campground|campgrounds|campsites?|rustic|recreation area|rec area|loop|boat[- ]in|state park|state forest|national forest|sra|the)\b/g;

/** The distinctive words of a campground name ("Baker Lake Rustic Campground" → "baker lake"). */
export function coreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(FILLER, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Name parts worth searching for, most specific first ("Chippewa Loop — Norway Beach …" → ["norway beach", "chippewa"]). */
export function searchPhrases(cg: Pick<Campground, 'name'>): string[] {
  const parts = cg.name.split(/\s+[—–-]\s+/).map(coreName).filter((p) => p.length >= 3);
  return [...new Set(parts.reverse())];
}

const GENERIC = new Set(['lake', 'lakes', 'river', 'creek', 'bay', 'point', 'island', 'beach', 'north', 'south', 'east', 'west', 'big', 'little', 'upper', 'lower', 'of']);

/** How well two names agree on their distinctive words (0–1); "lake", "river"… don't count on their own. */
function overlap(a: string, b: string): number {
  const words = (s: string) => {
    const all = s.split(' ').filter(Boolean);
    const distinct = all.filter((w) => !GENERIC.has(w));
    return distinct.length ? distinct : all;
  };
  const wa = new Set(words(a));
  const wb = words(b);
  if (!wa.size || !wb.length) return 0;
  return wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length);
}

// ---------------------------------------------------------------- state parks

/** The park this campground is in, from the statewide park list. */
export function matchPark(cg: Pick<Campground, 'name' | 'unit'>, parks: ParkPoint[]): ParkPoint | null {
  const wanted = [cg.unit, cg.name.split(/\s+[—–-]\s+/)[0] ?? cg.name].map((n) => normalizeName(n.replace(/campground/gi, '')));
  for (const w of wanted) {
    const hit = parks.find((p) => normalizeName(p.name) === w);
    if (hit) return hit;
  }
  return null;
}

const parksCache: Partial<Record<ParkRegion, Promise<ParkPoint[]>>> = {};

async function findStatePark(cg: Campground, fetchFn: typeof fetch, region: ParkRegion): Promise<LookupResult> {
  const who = region === 'sd' ? 'South Dakota GFP' : 'DNR';
  parksCache[region] ??= fetchParksFromService(fetchFn, region).then((r) => r.parks);
  let parks: ParkPoint[];
  try {
    parks = await parksCache[region]!;
  } catch (e) {
    delete parksCache[region];
    return { ok: false, message: `Couldn’t load the ${who} state park list (${errText(e)}).` };
  }
  if (!parks.length) {
    delete parksCache[region];
    return { ok: false, message: `The ${who} state park list came back empty.` };
  }
  const park = matchPark(cg, parks);
  if (!park) return { ok: false, message: `“${cg.unit || cg.name}” isn’t in the ${REGION_NAME[region]} state park list (${parks.length} parks).` };
  return {
    ok: true,
    found: {
      location: { lat: park.lat, lng: park.lng },
      source: `${region === 'sd' ? 'SD GFP park data' : 'MN DNR state park boundary'} for ${park.name}`,
      verify: 'Pin is the middle of the park, not the campground itself; drag it on the trip map if you want it exact.',
    },
  };
}

// ---------------------------------------------------------------- USFS

/** Best USFS recreation site for this campground, preferring campgrounds and closer name matches. */
export function bestUsfsMatch(cg: Pick<Campground, 'name' | 'unit'>, features: EsriFeature[]): { feature: EsriFeature; name: string } | null {
  const want = coreName(cg.name);
  const forest = cg.unit.toLowerCase().replace(/national forest/, '').trim();
  let best: { feature: EsriFeature; name: string; score: number } | null = null;
  for (const f of features) {
    const a = f.attributes ?? {};
    const name = pick(a, [/^recareaname$/i, /^site_?name$/i, /^name$/i, /name/i]);
    if (!name || !featurePoint(f)) continue;
    const text = Object.values(a).join(' ').toLowerCase();
    const nameScore = overlap(want, coreName(name));
    if (nameScore < 0.5) continue;
    let score = nameScore * 10;
    if (/camp/.test(text)) score += 2;
    if (forest && text.includes(forest)) score += 1;
    if (!best || score > best.score) best = { feature: f, name, score };
  }
  return best && best.score >= 5 ? { feature: best.feature, name: best.name } : null;
}

async function findUsfs(cg: Campground, fetchFn: typeof fetch): Promise<LookupResult> {
  let layers;
  try {
    layers = await listLayers(USFS_RECREATION_SERVICE, fetchFn);
  } catch (e) {
    return { ok: false, message: `Couldn’t reach the Forest Service recreation sites service (${errText(e)}).` };
  }
  // The layer with a recreation-area name field; point layers first.
  const layer =
    layers.find((l) => l.fields?.some((f) => /recareaname/i.test(f.name)) && /point/i.test(l.geometryType ?? '')) ??
    layers.find((l) => l.fields?.some((f) => /recareaname/i.test(f.name))) ??
    layers[0];
  if (!layer) return { ok: false, message: 'The Forest Service service has no layers.' };
  const nameField = layer.fields?.find((f) => /recareaname/i.test(f.name))?.name ?? layer.fields?.find((f) => /name/i.test(f.name))?.name;
  if (!nameField) return { ok: false, message: `No name field in Forest Service layer “${layer.name}”.` };

  const tried: string[] = [];
  for (const phrase of searchPhrases(cg)) {
    const word = phrase.replace(/[^a-z0-9 ]/g, '').toUpperCase();
    tried.push(word);
    let features: EsriFeature[];
    try {
      features = await queryLayer(
        `${USFS_RECREATION_SERVICE}/${layer.id}`,
        { bbox: SEARCH_BBOX, where: `UPPER(${nameField}) LIKE '%${word.replace(/'/g, "''")}%'` },
        fetchFn,
      );
    } catch (e) {
      return { ok: false, message: `Forest Service search failed (${errText(e)}).` };
    }
    const hit = bestUsfsMatch(cg, features);
    if (hit) {
      return {
        ok: true,
        found: {
          location: featurePoint(hit.feature)!,
          source: `USFS recreation sites: ${hit.name}`,
          verify: 'Location from Forest Service recreation site data; check the pin before relying on it.',
        },
      };
    }
  }
  return { ok: false, message: `No Forest Service recreation site matched ${tried.map((t) => `“${t}”`).join(' or ')}.` };
}

/** Look up a campground's location in the official data for its agency. */
export async function findCampgroundLocation(cg: Campground, fetchFn: typeof fetch): Promise<LookupResult> {
  if (cg.agency === 'mn-state-park') return findStatePark(cg, fetchFn, 'mn');
  if (cg.agency === 'sd-state-park') return findStatePark(cg, fetchFn, 'sd');
  if (cg.agency === 'usfs') return findUsfs(cg, fetchFn);
  return {
    ok: false,
    message: 'There’s no official location source for this kind of campground in the app yet. Tap the trip map to place it.',
  };
}

/** The campground with its new location and a note saying where it came from. */
export function withFoundLocation(cg: Campground, found: FoundLocation): Campground {
  const verify = cg.verify.includes(found.verify) ? cg.verify : [cg.verify, found.verify].filter(Boolean).join(' ');
  const source = cg.source.includes(found.source) ? cg.source : [cg.source, `Location: ${found.source}.`].filter(Boolean).join(' ');
  return { ...cg, location: found.location, verify, source };
}
