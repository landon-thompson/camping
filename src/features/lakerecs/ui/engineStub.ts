/**
 * TEMPORARY stand-in for Agent C's engine (src/features/lakerecs/index.ts), so
 * the UI can be built and checked before the engine lands. Implements the
 * exact signatures listed in ../types.ts with synthetic "Fixture Lake …" data
 * near 47.9, -91.9. Nothing here is real: names, numbers, regulation text and
 * links are made up for testing. Removed at integration (ui/engine.ts swaps to
 * `export * from '../index'`).
 *
 * Dev switch (this stub only): localStorage `lakeRecsStub` = `ready` (default)
 * | `missing` (tiles not downloaded until "Download") | `none` (no model).
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { newId, saveRecord, useRecords } from '../../../db/records';
import type { FishingLog } from '../../../model/lakerecs';
import { speciesName } from '../../fishing/lakeSurvey';
import type {
  Confidence,
  Factor,
  LakeModelStatus,
  LakeRec,
  ModelManifest,
  ModelTile,
  RecContext,
  RecResult,
  SpeciesEstimate,
  TileLake,
  TileLaunch,
  UseLakeRecs,
} from '../types';
import { useOnline } from './useOnline';

export const DEFAULT_WEIGHTS = {
  fishPerDoubling: 10,
  driveFreeMin: 10,
  drivePerMin: 1 / 5,
  roadFactor: 1.35,
  speedKmh: 70,
  launch: { concrete: 0, gravel: -2, unknown: -3, 'carry-in': -15 },
} as const;

// ------------------------------------------------------------ fixture data (synthetic)

const ln = Math.log;
const FIX_URL = 'https://example.org/fixture';
const est = (med: number, p10: number, p90: number, surveys: number, latestYear: number | null, ownWeight: number, sizeIndex: number | null = null): SpeciesEstimate => ({
  med: ln(med),
  p10: ln(p10),
  p90: ln(p90),
  q: '', // the stub doesn't decode samples
  sizeIndex,
  evidence: {
    surveys,
    latestYear,
    ownWeight,
    sources: Array.from({ length: Math.min(surveys, 3) }, (_, i) => ({
      date: `${(latestYear ?? 2020) - i * 5}-07-15`,
      type: i === 0 ? 'Standard Survey' : 'Population Assessment',
      gear: 'Standard gill nets',
      cpue: Math.round(med * 8 * (1 - i * 0.15) * 10) / 10,
      url: `${FIX_URL}/survey-${latestYear ?? 2020}-${i}`,
    })),
  },
});
const launch = (name: string, lat: number, lng: number, ramp: string, rampClass: TileLaunch['rampClass']): TileLaunch => ({ name, lat, lng, ramp, rampClass, source: 'Fixture data' });
const lake = (o: Partial<TileLake> & Pick<TileLake, 'key' | 'name' | 'lat' | 'lng' | 'launches' | 'sp'>): TileLake => ({
  state: 'MN',
  county: 'Fixture County',
  areaAcres: null,
  maxDepthFt: null,
  clarityFt: null,
  sourceUrl: `${FIX_URL}/${o.key}`,
  regs: [],
  stocking: [],
  ...o,
});

export const FIXTURE_LAKES: TileLake[] = [
  lake({
    key: 'mn:69000001',
    name: 'Fixture Lake North',
    lat: 47.93,
    lng: -91.86,
    areaAcres: 1240,
    maxDepthFt: 45,
    clarityFt: 9,
    launches: [launch('Fixture North public access', 47.925, -91.872, 'Concrete', 'concrete')],
    regs: [{ species: 'WAE', text: 'FIXTURE — sample regulation text for testing only, not a real rule.', url: `${FIX_URL}/regs`, fetchedAt: '2026-10-01T00:00:00Z' }],
    stocking: [
      { year: 2024, species: 'WAE', count: 250000, size: 'fry' },
      { year: 2022, species: 'WAE', count: 4100, size: 'fingerling' },
    ],
    sp: {
      WAE: est(1.7, 0.9, 3.1, 3, 2022, 0.7, 1.1),
      NOP: est(1.1, 0.7, 1.7, 3, 2022, 0.75),
      BLC: est(0.8, 0.4, 1.6, 2, 2017, 0.45),
      YEP: est(1.3, 0.8, 2.0, 3, 2022, 0.7),
    },
  }),
  lake({
    key: 'mn:69000002',
    name: 'Fixture Lake Birch',
    lat: 47.86,
    lng: -91.97,
    areaAcres: 410,
    maxDepthFt: 22,
    clarityFt: 6,
    launches: [launch('Fixture Birch landing', 47.858, -91.962, 'Gravel', 'gravel')],
    stocking: [],
    sp: {
      WAE: est(1.2, 0.5, 2.6, 1, 2014, 0.25),
      NOP: est(1.6, 1.0, 2.5, 1, 2014, 0.4),
      BLC: est(1.5, 0.7, 3.0, 1, 2014, 0.3),
      BLG: est(1.1, 0.5, 2.2, 1, 2014, 0.3),
    },
  }),
  lake({
    key: 'mn:69000003',
    name: 'Fixture Lake Pine',
    lat: 47.99,
    lng: -91.77,
    areaAcres: 2300,
    maxDepthFt: 70,
    clarityFt: 12,
    launches: [
      launch('Fixture Pine east ramp', 47.992, -91.762, 'Concrete', 'concrete'),
      launch('Fixture Pine south access', 47.981, -91.781, '', 'unknown'),
    ],
    sp: {
      WAE: est(2.2, 0.45, 6, 0, null, 0.05),
      SMB: est(1.8, 0.8, 3.6, 2, 2021, 0.55, 1.3),
      NOP: est(0.9, 0.4, 1.9, 0, null, 0.05),
    },
  }),
  lake({
    key: 'mn:69000004',
    name: 'Fixture Lake Carry',
    lat: 47.88,
    lng: -91.83,
    launches: [launch('Fixture Carry trail', 47.879, -91.835, 'Carry-in', 'carry-in')],
    sp: { WAE: est(2.0, 1.1, 3.5, 2, 2020, 0.6) },
  }),
  lake({
    key: 'mn:69000005',
    name: 'Fixture Lake Perch',
    lat: 47.91,
    lng: -91.95,
    launches: [launch('Fixture Perch access', 47.909, -91.952, 'Concrete', 'concrete')],
    sp: { YEP: est(1.4, 0.9, 2.2, 2, 2019, 0.6), BLG: est(1.9, 1.0, 3.4, 2, 2019, 0.6) },
  }),
];

const FIXTURE_TILE: ModelTile = { format: 1, version: '2026.10.1-fixture', id: 't_47.5_-92', scale: { WAE: { lo: -2, hi: 2.5 } }, lakes: FIXTURE_LAKES };

// ------------------------------------------------------------ ranking (simplified, for the stub only)

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function seededNormal(seed: number, key: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 2654435761) >>> 0;
  const rand = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RAMP_TEXT: Record<TileLaunch['rampClass'], string> = { concrete: 'Concrete ramp', gravel: 'Gravel ramp', unknown: 'Ramp type unknown', 'carry-in': 'Carry-in only' };

export function recommendLakes(ctx: RecContext, data: { tiles: ModelTile[]; logs: FishingLog[]; manifest: ModelManifest | null }): RecResult {
  const W = DEFAULT_WEIGHTS;
  const radius = ctx.radiusKm ?? 40.2;
  const fish = speciesName(ctx.species).toLowerCase();
  const excluded: RecResult['excluded'] = [];
  const scored: Omit<LakeRec, 'rank' | 'vsNext'>[] = [];
  for (const tile of data.tiles) {
    for (const l of tile.lakes) {
      const distanceKm = haversineKm(ctx.origin, l);
      if (distanceKm > radius) continue;
      const usable = l.launches.filter((x) => !ctx.towing || x.rampClass !== 'carry-in');
      if (!l.launches.length) {
        excluded.push({ name: l.name, why: 'no public launch' });
        continue;
      }
      if (!usable.length) {
        excluded.push({ name: l.name, why: 'carry-in only (you’re towing)' });
        continue;
      }
      const e = l.sp[ctx.species];
      if (!e) {
        excluded.push({ name: l.name, why: `no estimate for ${fish}` });
        continue;
      }
      const best = [...usable].sort((a, b) => W.launch[a.rampClass] - W.launch[b.rampClass])[0]!;
      const driveMin = (distanceKm * W.roadFactor * 60) / W.speedKmh;
      const theta =
        ctx.mode === 'safe' ? e.p10 : ctx.mode === 'expected' ? e.med : e.med + ((e.p90 - e.p10) / 2.563) * seededNormal(ctx.seed, l.key);
      const index = Math.exp(theta);
      const logs = data.logs.filter((g) => g.lakeKey === l.key);
      const rated = logs.filter((g) => g.rating !== null);
      const usedFamilyLog = logs.some((g) => g.targetSpecies.includes(ctx.species) || g.catches.some((c) => c.species === ctx.species));
      const factors: Factor[] = [
        { key: 'fish', points: W.fishPerDoubling * Math.log2(index), text: `About ${index.toFixed(1)}× the ${fish} of a typical lake` },
        { key: 'drive', points: -Math.max(0, driveMin - W.driveFreeMin) * W.drivePerMin, text: `About ${Math.round(driveMin)} min away` },
        { key: 'launch', points: ctx.towing ? W.launch[best.rampClass] : 0, text: ctx.towing ? RAMP_TEXT[best.rampClass] : `${RAMP_TEXT[best.rampClass]} (not towing, so it doesn’t count)` },
      ];
      if (ctx.startDate) {
        const m = Number(ctx.startDate.slice(5, 7)) - 1;
        factors.push({ key: 'season', points: m >= 4 && m <= 5 ? 3 : 0, text: `${MONTHS[m]} is usually ${m >= 4 && m <= 5 ? 'good' : 'fair'} for ${fish} (estimate)` });
      }
      if (rated.length) {
        const last = rated.sort((a, b) => b.date.localeCompare(a.date))[0]!;
        factors.push({ key: 'family', points: Math.max(0, Math.min(4, (last.rating! - 3) * 2)), text: `You rated it ${last.rating}/5 last time` });
      }
      const score = factors.reduce((s, f) => s + f.points, 0);
      const ev = e.evidence;
      const range = { p10: Math.exp(e.p10), med: Math.exp(e.med), p90: Math.exp(e.p90) };
      const age = ev.latestYear ? new Date().getFullYear() - ev.latestYear : 99;
      const confidence: Confidence =
        ev.ownWeight >= 0.6 && ev.surveys >= 2 && age <= 6 && range.p90 / range.p10 <= 4 ? 'high' : ev.ownWeight >= 0.3 && age <= 12 ? 'medium' : 'low';
      const weakSpots = [
        confidence === 'low' && 'Mostly based on similar lakes',
        age > 8 && ev.latestYear && `Latest survey is from ${ev.latestYear}`,
        !ev.surveys && `No survey of this lake for ${fish}`,
        best.rampClass === 'unknown' && 'Ramp type unknown',
        best.rampClass === 'gravel' && 'Gravel ramp',
        driveMin > 40 && 'Long drive',
        l.regs.some((r) => r.species === ctx.species || r.species === null) && 'Special regulation — read it before you go',
      ].filter((x): x is string => !!x);
      scored.push({
        lake: l,
        launch: best,
        distanceKm,
        driveMin,
        score,
        factors,
        range,
        confidence,
        confidenceText:
          confidence === 'high'
            ? `Based on ${ev.surveys} recent surveys of this lake`
            : confidence === 'medium'
              ? 'Some surveys of this lake, partly filled in from similar lakes'
              : 'Mostly based on similar lakes',
        reasons: [...factors].filter((f) => f.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((f) => f.text).concat(factors.every((f) => f.points <= 0) ? [factors[1]!.text] : []),
        weakSpots,
        usedFamilyLog,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const recs: LakeRec[] = scored.map((r, i) => {
    const next = scored[i + 1];
    let vsNext: string | null = null;
    if (next) {
      const diff = (k: string) => (r.factors.find((f) => f.key === k)?.points ?? 0) - (next.factors.find((f) => f.key === k)?.points ?? 0);
      const extraMin = Math.round(r.driveMin - next.driveMin);
      vsNext = `Beats #${i + 2} mainly on ${fish} (${diff('fish') >= 0 ? '+' : ''}${diff('fish').toFixed(0)} pts)${extraMin > 2 ? ` despite ${extraMin} more minutes of driving` : ''}.`;
    }
    return { ...r, rank: i + 1, vsNext };
  });
  return { recs, excluded, modelVersion: data.tiles[0]?.version ?? null, missingTiles: [] };
}

// ------------------------------------------------------------ stub state + hooks

type StubMode = 'ready' | 'missing' | 'none';
const readMode = (): StubMode => {
  try {
    const v = localStorage.getItem('lakeRecsStub');
    return v === 'missing' || v === 'none' ? v : 'ready';
  } catch {
    return 'ready';
  }
};

let stub = { mode: readMode(), downloaded: readMode() !== 'missing', updating: false };
const listeners = new Set<() => void>();
const setStub = (patch: Partial<typeof stub>) => {
  stub = { ...stub, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useStub = () => useSyncExternalStore(subscribe, () => stub);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusFrom(s: typeof stub, online: boolean): LakeModelStatus {
  if (s.mode === 'none') return { state: online ? 'none' : 'offline', version: null, createdAt: null, tilesOnPhone: 0, bytesOnPhone: 0 };
  const tiles = s.downloaded ? 1 : 0;
  return {
    state: !online ? 'offline' : s.updating ? 'updating' : 'ready',
    version: FIXTURE_TILE.version,
    createdAt: '2026-10-01T09:00:00Z',
    tilesOnPhone: tiles,
    bytesOnPhone: tiles * 96_000,
  };
}

export function useLakeModelStatus(): LakeModelStatus & { update(): Promise<void> } {
  const s = useStub();
  const online = useOnline();
  return {
    ...statusFrom(s, online),
    update: async () => {
      if (!navigator.onLine || stub.mode === 'none') return;
      setStub({ updating: true });
      await wait(800);
      setStub({ updating: false });
    },
  };
}

const daySeed = () => Math.floor(Date.now() / 86_400_000);

export function useLakeRecs(ctx: Omit<RecContext, 'seed'> | null): UseLakeRecs {
  const s = useStub();
  const online = useOnline();
  const logs = useRecords('fishing_log');
  const [roll, setRoll] = useState(0);
  const key = ctx ? JSON.stringify(ctx) : '';
  const logKey = logs.rows.map((r) => `${r.id}@${r.updatedAt}`).join('|');
  const result = useMemo<RecResult | null>(() => {
    if (!ctx || s.mode === 'none') return null;
    if (!s.downloaded) return { recs: [], excluded: [], modelVersion: FIXTURE_TILE.version, missingTiles: [FIXTURE_TILE.id] };
    return recommendLakes({ ...ctx, seed: daySeed() + roll }, { tiles: [FIXTURE_TILE], logs: logs.rows.map((r) => r.data), manifest: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value
  }, [key, s.mode, s.downloaded, roll, logKey]);
  return {
    loading: logs.loading,
    result,
    status: statusFrom(s, online),
    download: async () => {
      if (!navigator.onLine) return;
      setStub({ updating: true });
      await wait(600);
      setStub({ updating: false, downloaded: true });
    },
    rollAgain: () => setRoll((r) => r + 1),
  };
}

export async function saveFishingLog(log: FishingLog): Promise<string> {
  const id = newId('fishing_log');
  await saveRecord('fishing_log', id, log);
  return id;
}
