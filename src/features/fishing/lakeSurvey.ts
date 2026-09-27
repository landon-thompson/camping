import type { FishCatch, LakeSurvey, NearbyLake } from '../../model/schemas';

/**
 * Official MN DNR LakeFinder data: fish survey summaries per lake (by DOW
 * number) and lakes near a point. Read-only public DNR endpoints, fetched
 * through the app's server (no CORS on the DNR side). The JSON layout isn't
 * formally documented, so parsing matches field names loosely.
 */
export const lakeSurveyUrl = (dow: string) => `https://maps.dnr.state.mn.us/cgi-bin/lakefinder/detail.cgi?type=lake_survey&id=${dow}`;
export const lakesNearUrl = (lat: number, lng: number, radiusM: number) =>
  `https://services.dnr.state.mn.us/api/lakefinder/by_point/v1?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&radius=${Math.round(radiusM)}`;
/** The lake's official LakeFinder page (maps, surveys, stocking, regulations). */
export const lakeFinderPage = (dow: string) => `https://www.dnr.state.mn.us/lakefind/lake.html?id=${dow}`;

/** DNR fisheries species codes → common names. Unknown codes are shown as-is. */
export const SPECIES: Record<string, string> = {
  WAE: 'Walleye',
  SAR: 'Sauger',
  NOP: 'Northern pike',
  MUE: 'Muskellunge',
  TME: 'Tiger muskie',
  YEP: 'Yellow perch',
  BLC: 'Black crappie',
  WHC: 'White crappie',
  BLG: 'Bluegill',
  PMK: 'Pumpkinseed',
  GSF: 'Green sunfish',
  HSF: 'Hybrid sunfish',
  RKB: 'Rock bass',
  LMB: 'Largemouth bass',
  SMB: 'Smallmouth bass',
  WHB: 'White bass',
  TLC: 'Cisco (tullibee)',
  CIS: 'Cisco (tullibee)',
  LKW: 'Lake whitefish',
  LAT: 'Lake trout',
  RBT: 'Rainbow trout',
  BNT: 'Brown trout',
  BKT: 'Brook trout',
  SPT: 'Splake',
  BUB: 'Burbot (eelpout)',
  BLB: 'Black bullhead',
  BRB: 'Brown bullhead',
  YEB: 'Yellow bullhead',
  CCF: 'Channel catfish',
  FCF: 'Flathead catfish',
  WTS: 'White sucker',
  SHR: 'Shorthead redhorse',
  GRH: 'Golden redhorse',
  SLR: 'Silver redhorse',
  CAP: 'Common carp',
  BIB: 'Bigmouth buffalo',
  FRD: 'Freshwater drum',
  BOF: 'Bowfin (dogfish)',
  LNG: 'Longnose gar',
  SNG: 'Shortnose gar',
  GOS: 'Golden shiner',
  GZS: 'Gizzard shad',
  GOE: 'Goldeye',
  MOE: 'Mooneye',
  LKS: 'Lake sturgeon',
  HFC: 'Hybrid (walleye × sauger)',
};

/** Species people usually fish for, drawn in the accent colour. */
const GAME = new Set(['WAE', 'SAR', 'NOP', 'MUE', 'TME', 'YEP', 'BLC', 'WHC', 'BLG', 'PMK', 'LMB', 'SMB', 'RKB', 'LAT', 'RBT', 'BNT', 'BKT', 'SPT', 'LKW', 'TLC', 'CIS', 'CCF', 'FCF', 'HSF', 'WHB']);
export const isGameFish = (code: string) => GAME.has(code.toUpperCase());
export const speciesName = (code: string) => SPECIES[code.toUpperCase()] ?? code;

// ---------------------------------------------------------------- parsing

type Obj = Record<string, unknown>;
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
function get(o: Obj, ...names: string[]): unknown {
  const want = names.map(norm);
  for (const [k, v] of Object.entries(o)) if (want.includes(norm(k))) return v;
  return undefined;
}
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** "3.3-10.5" → [3.3, 10.5]; anything else → nulls. */
export function parseRange(v: unknown): [number | null, number | null] {
  const m = /(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/.exec(str(v));
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

/** JSON, or JSONP-wrapped JSON (`callback({...})`). */
export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error('Not JSON');
  }
}

export function parseLakeSurvey(data: unknown, dow: string, now = new Date()): LakeSurvey {
  if (!data || typeof data !== 'object') throw new Error('LakeFinder sent no data');
  const top = data as Obj;
  const result = get(top, 'result') as Obj | undefined;
  if (!result || typeof result !== 'object') {
    throw new Error(str(get(top, 'message')) || 'LakeFinder has no survey for that lake');
  }
  const rawSurveys = (get(result, 'surveys') as unknown[] | undefined) ?? [];
  const surveys = rawSurveys
    .filter((s): s is Obj => !!s && typeof s === 'object')
    .map((s) => {
      const rows = (get(s, 'fishCatchSummaries', 'catchSummaries') as unknown[] | undefined) ?? [];
      const catches: FishCatch[] = rows
        .filter((r): r is Obj => !!r && typeof r === 'object')
        .map((r) => {
          const [lo, hi] = parseRange(get(r, 'quartileCount', 'quartileRange'));
          return {
            species: str(get(r, 'species', 'speciesCode')).toUpperCase(),
            gear: str(get(r, 'gear', 'gearType')),
            gearCount: num(get(r, 'gearCount')),
            totalCatch: num(get(r, 'totalCatch')),
            cpue: num(get(r, 'CPUE', 'catchPerUnitEffort')),
            normalLow: lo,
            normalHigh: hi,
            avgWeightLb: num(get(r, 'averageWeight')),
          };
        })
        .filter((c) => c.species);
      return {
        date: str(get(s, 'surveyDate', 'date')).slice(0, 10),
        type: [str(get(s, 'surveyType')), str(get(s, 'surveySubType'))].filter(Boolean).join(' · '),
        catches,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    dow,
    lakeName: str(get(result, 'lakeName', 'name')) || `Lake ${dow}`,
    fetchedAt: now.toISOString(),
    surveys,
  };
}

/** Lakes in a LakeFinder "by point" answer: any object with an 8-digit id and a name. */
export function parseNearbyLakes(data: unknown): NearbyLake[] {
  const out: NearbyLake[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Obj;
    const id = str(get(o, 'id', 'dowNumber', 'dow', 'downum')).replace(/\D/g, '');
    const name = str(get(o, 'name', 'lakeName'));
    if (id.length === 8 && name && !seen.has(id)) {
      seen.add(id);
      out.push({ dow: id, name, county: str(get(o, 'county', 'countyName')) });
      return;
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(data, 0);
  return out;
}

/** An 8-digit DOW number from what the owner pasted: a LakeFinder link, "69-0254-00", or "69025400". */
export function parseDowInput(text: string): string | null {
  const fromLink = /[?&](?:id|downum)=(\d{8})\b/i.exec(text);
  if (fromLink) return fromLink[1]!;
  const digits = text.replace(/[\s-]/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

// ---------------------------------------------------------------- breakdown

export type Rating = 'below' | 'typical' | 'above' | null;
/** Compared with DNR's typical range for similar lakes. */
export function rate(c: Pick<FishCatch, 'cpue' | 'normalLow' | 'normalHigh'>): Rating {
  if (c.cpue === null || c.normalLow === null || c.normalHigh === null) return null;
  if (c.cpue < c.normalLow) return 'below';
  if (c.cpue > c.normalHigh) return 'above';
  return 'typical';
}

export function gearFamily(gear: string): string {
  if (/gill/i.test(gear)) return 'Gill nets';
  if (/trap/i.test(gear)) return 'Trap nets';
  if (/electro|boat ?shock/i.test(gear)) return 'Electrofishing';
  if (/seine/i.test(gear)) return 'Seines';
  return gear || 'Other';
}

export interface GearGroup {
  family: string;
  /** e.g. "fish per net" */
  unit: string;
  netCount: number | null;
  rows: FishCatch[];
  maxCpue: number;
}

/** Survey rows grouped by kind of net, one row per species (standard nets preferred), most abundant first. */
export function groupByGear(catches: FishCatch[]): GearGroup[] {
  const families = new Map<string, Map<string, FishCatch>>();
  for (const c of catches) {
    const fam = gearFamily(c.gear);
    const bySpecies = families.get(fam) ?? new Map<string, FishCatch>();
    const prev = bySpecies.get(c.species);
    if (!prev || (/standard/i.test(c.gear) && !/standard/i.test(prev.gear))) bySpecies.set(c.species, c);
    families.set(fam, bySpecies);
  }
  const order = ['Gill nets', 'Trap nets', 'Electrofishing'];
  return [...families.entries()]
    .map(([family, m]) => {
      const rows = [...m.values()].sort((a, b) => (b.cpue ?? -1) - (a.cpue ?? -1));
      return {
        family,
        unit: family === 'Electrofishing' ? 'fish per hour' : 'fish per net',
        netCount: rows.find((r) => r.gearCount !== null)?.gearCount ?? null,
        rows,
        // Scale bars so both the catch and the typical range fit.
        maxCpue: Math.max(0, ...rows.map((r) => Math.max(r.cpue ?? 0, r.normalHigh ?? 0))),
      };
    })
    .sort((a, b) => (order.indexOf(a.family) + 1 || 9) - (order.indexOf(b.family) + 1 || 9));
}

export interface CatchShare {
  species: string;
  count: number;
  pct: number;
}

/** Share of all fish caught in the survey, by species (all nets together). */
export function catchShares(catches: FishCatch[]): CatchShare[] {
  const totals = new Map<string, number>();
  for (const c of catches) if (c.totalCatch) totals.set(c.species, (totals.get(c.species) ?? 0) + c.totalCatch);
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (!sum) return [];
  return [...totals.entries()]
    .map(([species, count]) => ({ species, count, pct: (count / sum) * 100 }))
    .sort((a, b) => b.count - a.count);
}

/** The newest survey that has catch data. */
export function latestWithCatch(s: LakeSurvey): LakeSurvey['surveys'][number] | null {
  return s.surveys.find((x) => x.catches.length > 0) ?? null;
}

/** Fetch and parse one lake's surveys. */
export async function fetchLakeSurvey(dow: string, fetchFn: typeof fetch): Promise<LakeSurvey> {
  const res = await fetchFn(lakeSurveyUrl(dow));
  const text = await res.text();
  if (!res.ok) {
    let why = '';
    try {
      why = str((JSON.parse(text) as Obj).error);
    } catch {
      /* not JSON */
    }
    throw new Error(`HTTP ${res.status}${why ? ` — ${why}` : ''}`);
  }
  return parseLakeSurvey(parseJsonLoose(text), dow);
}

/** Lakes within `radiusM` of a point, from LakeFinder. */
export async function fetchLakesNear(lat: number, lng: number, fetchFn: typeof fetch, radiusM = 3000): Promise<NearbyLake[]> {
  const url = lakesNearUrl(lat, lng, radiusM);
  let res: Response;
  try {
    res = await fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    res = await fetchFn(url.replace('https:', 'http:')); // the DNR documents this API on http
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseNearbyLakes(parseJsonLoose(await res.text()));
}
