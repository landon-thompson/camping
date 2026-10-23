import type { FishingLog } from '../../model/lakerecs';
import { LAKE_RADIUS_KM, speciesName } from '../fishing/lakeSurvey';
import { distanceKm } from '../places/arcgis';
import { decodeSamples } from './decode';
import {
  confidenceFor,
  driveText,
  familyText,
  fishText,
  kmToMi,
  launchText,
  partOfMonth,
  reasonsFor,
  seasonText,
  vsNextText,
  weakSpotsFor,
  type FamilyHistory,
} from './explain';
import { applyFamilyLog, normalQuantile } from './familyLog';
import { tilesFor } from './tiles';
import type { Factor, LakeKey, LakeRec, ModelManifest, ModelTile, RecContext, RecResult, SpeciesCode, TileLake, TileLaunch } from './types';
import { catchRate, DEFAULT_WEIGHTS, type LakeRecWeights } from './weights';

/**
 * Pure ranking (docs/LAKE_RECS_PLAN.md §4): no storage, no network, same
 * input → same output. Score = fish + drive + launch + season + family.
 */

type LatLng = { lat: number; lng: number };

export interface RecData {
  tiles: ModelTile[];
  logs: FishingLog[];
  manifest: ModelManifest | null;
}

export interface RecOptions {
  weights?: LakeRecWeights;
  /** "Today", for survey ages. Defaults to the current date. */
  now?: Date;
}

const round1 = (x: number) => Math.round(x * 10) / 10 || 0; // `|| 0` folds −0 into 0

// ------------------------------------------------------------ factors

export function driveMinutes(km: number, w: LakeRecWeights = DEFAULT_WEIGHTS): number {
  return ((km * w.roadFactor.value) / w.speedKmh.value) * 60;
}

export function drivePoints(min: number, w: LakeRecWeights = DEFAULT_WEIGHTS): number {
  return (-w.drivePointsPer5Min.value * Math.max(0, min - w.driveFreeMin.value)) / 5;
}

/** θ is the log-index (ln of the multiple of a typical lake). */
export function fishPoints(theta: number, w: LakeRecWeights = DEFAULT_WEIGHTS): number {
  return (w.fishPerDoubling.value * theta) / Math.LN2;
}

export function launchPoints(launch: TileLaunch | null, towing: boolean, w: LakeRecWeights = DEFAULT_WEIGHTS): number {
  if (!towing || !launch) return 0;
  return (w.launch[launch.rampClass] ?? w.launch.unknown).value;
}

const DAY = 86_400_000;
function parseDay(s: string | null): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Season points averaged over the trip's days (estimate table), plus the "Early June" label. */
export function seasonFit(
  species: SpeciesCode,
  startDate: string | null,
  endDate: string | null,
  w: LakeRecWeights = DEFAULT_WEIGHTS,
): { points: number; when: string | null; hasRow: boolean } {
  const row = w.season[species];
  const start = parseDay(startDate) ?? parseDay(endDate);
  if (start == null) return { points: 0, when: null, hasRow: !!row };
  let end = parseDay(endDate) ?? start;
  if (end < start) end = start;
  end = Math.min(end, start + 60 * DAY);
  const when = partOfMonth(new Date(start + Math.floor((end - start) / DAY / 2) * DAY));
  if (!row) return { points: 0, when, hasRow: false };
  let sum = 0;
  let n = 0;
  for (let t = start; t <= end; t += DAY) {
    sum += row.months[new Date(t).getUTCMonth()] ?? 0;
    n++;
  }
  return { points: Math.max(-5, Math.min(5, sum / n)), when, hasRow: true };
}

/** Family bonus from outing ratings at this lake (any species): newest three, averaged. */
export function familyHistory(logs: FishingLog[], lakeKey: LakeKey, w: LakeRecWeights = DEFAULT_WEIGHTS): FamilyHistory {
  const ratings = logs
    .filter((l) => l.lakeKey === lakeKey && l.rating != null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((l) => l.rating!);
  if (!ratings.length) return { points: 0, ratings, average: null };
  const recent = ratings.slice(0, 3);
  const average = recent.reduce((s, r) => s + r, 0) / recent.length;
  const zero = w.familyZeroRating.value;
  const max = w.familyMaxPoints.value;
  const points = Math.max(0, Math.min(max, ((average - zero) / (5 - zero)) * max));
  return { points, ratings, average };
}

// ------------------------------------------------------------ randomness (Thompson)

/** Small fast seeded PRNG → [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-lake seed so adding a tile never reshuffles the other lakes' draws. */
export function lakeSeed(seed: number, key: string, species: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (const ch of `${key}|${species}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function thompsonDraw(
  samples: Float64Array,
  weights: Float64Array | null,
  summary: { med: number; p10: number; p90: number },
  rng: () => number,
): number {
  const u = rng();
  if (samples.length && weights) {
    let acc = 0;
    for (let i = 0; i < samples.length; i++) {
      acc += weights[i]!;
      if (u < acc) return samples[i]!;
    }
    return samples[samples.length - 1]!;
  }
  if (samples.length) return samples[Math.min(samples.length - 1, Math.floor(u * samples.length))]!;
  const sigma = Math.max(0, (summary.p90 - summary.p10) / (2 * 1.2815515655446004));
  return summary.med + sigma * normalQuantile(Math.min(1 - 1e-9, Math.max(1e-9, u)));
}

// ------------------------------------------------------------ launches

/** Nearest launch to the origin that suits the trip (towing → not carry-in). */
export function pickLaunch(launches: TileLaunch[], origin: LatLng, towing: boolean): TileLaunch | null {
  let best: TileLaunch | null = null;
  let bestKm = Infinity;
  for (const l of launches) {
    if (towing && l.rampClass === 'carry-in') continue;
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) continue;
    const km = distanceKm(origin, l);
    if (km < bestKm) {
      best = l;
      bestKm = km;
    }
  }
  return best;
}

// ------------------------------------------------------------ ranking

interface Scored extends Omit<LakeRec, 'rank' | 'vsNext' | 'reasons'> {
  fishPts: number;
}

export function recommendLakes(ctx: RecContext, data: RecData, opts: RecOptions = {}): RecResult {
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const year = (opts.now ?? new Date()).getFullYear();
  const radius = ctx.radiusKm ?? LAKE_RADIUS_KM;
  const manifest = data.manifest;
  const info = manifest?.species.find((s) => s.code === ctx.species);
  const sp = (info?.name ?? speciesName(ctx.species)).toLowerCase();
  const tiles = (data.tiles ?? []).filter((t) => t && Array.isArray(t.lakes));
  const have = new Set(tiles.map((t) => t.id));
  const missingTiles = tilesFor(ctx.origin, radius, manifest).filter((id) => !have.has(id));
  const modelVersion = manifest?.version ?? tiles[0]?.version ?? null;
  const logs = data.logs ?? [];
  const season = seasonFit(ctx.species, ctx.startDate, ctx.endDate, w);

  const excluded: RecResult['excluded'] = [];
  const scored: Scored[] = [];
  const seen = new Set<string>();

  for (const tile of tiles) {
    const scale = tile.scale?.[ctx.species];
    for (const lake of tile.lakes) {
      if (!lake || seen.has(lake.key)) continue;
      seen.add(lake.key);
      const launches = Array.isArray(lake.launches) ? lake.launches : [];
      const nearestKm = Math.min(distanceKm(ctx.origin, lake), ...launches.map((l) => distanceKm(ctx.origin, l)));
      const est = lake.sp?.[ctx.species];
      if (!(nearestKm <= radius)) {
        if (est && nearestKm <= radius * w.nearMissFactor) excluded.push({ name: lake.name, why: `a bit too far (${Math.round(kmToMi(nearestKm))} mi)` });
        continue;
      }
      if (!est || ![est.med, est.p10, est.p90].every(Number.isFinite)) {
        excluded.push({ name: lake.name, why: `no estimate for ${sp}` });
        continue;
      }
      if (!launches.length) {
        excluded.push({ name: lake.name, why: 'no public launch listed' });
        continue;
      }
      const launch = pickLaunch(launches, ctx.origin, ctx.towing);
      if (!launch) {
        excluded.push({ name: lake.name, why: ctx.towing ? "carry-in access only (you're towing)" : 'no usable launch' });
        continue;
      }
      scored.push(scoreLake(ctx, lake, launch, est, scale, logs, season, sp, info?.primaryGear ?? null, year, w));
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.fishPts - a.fishPts ||
      a.driveMin - b.driveMin ||
      a.lake.name.localeCompare(b.lake.name) ||
      (a.lake.key < b.lake.key ? -1 : a.lake.key > b.lake.key ? 1 : 0),
  );

  const recs: LakeRec[] = scored.map(({ fishPts: _f, ...s }, i) => ({
    ...s,
    rank: i + 1,
    reasons: reasonsFor({ factors: s.factors, driveMin: s.driveMin, launch: s.launch, towing: ctx.towing }),
    vsNext: null,
  }));
  for (let i = 0; i < recs.length - 1; i++) recs[i]!.vsNext = vsNextText(recs[i]!, recs[i + 1]!, sp);
  excluded.sort((a, b) => a.name.localeCompare(b.name));
  return { recs, excluded, modelVersion, missingTiles };
}

function scoreLake(
  ctx: RecContext,
  lake: TileLake,
  launch: TileLaunch,
  est: NonNullable<TileLake['sp'][string]>,
  scale: { lo: number; hi: number } | undefined,
  logs: FishingLog[],
  season: ReturnType<typeof seasonFit>,
  sp: string,
  primaryGear: string | null,
  year: number,
  w: LakeRecWeights,
): Scored {
  const samples = scale ? decodeSamples(est.q, scale) : new Float64Array(0);
  const fam = applyFamilyLog(est, samples, logs, lake.key, ctx.species, {
    tempering: w.journalTempering.value,
    ratePerHour: catchRate(w, ctx.species),
  });
  const theta =
    ctx.mode === 'safe'
      ? fam.p10
      : ctx.mode === 'expected'
        ? fam.med
        : thompsonDraw(samples, fam.weights, fam, mulberry32(lakeSeed(ctx.seed, lake.key, ctx.species)));
  const distanceKmToLaunch = distanceKm(ctx.origin, launch);
  const driveMin = driveMinutes(distanceKmToLaunch, w);
  const history = familyHistory(logs, lake.key, w);

  const factors: Factor[] = [
    { key: 'fish', points: round1(fishPoints(theta, w)), text: fishText(Math.exp(theta), sp, ctx.mode) },
    { key: 'drive', points: round1(drivePoints(driveMin, w)), text: driveText(driveMin) },
    { key: 'launch', points: round1(launchPoints(launch, ctx.towing, w)), text: launchText(launch, ctx.towing) },
    { key: 'season', points: round1(season.points), text: seasonText(season.points, season.when, sp, season.hasRow) },
    { key: 'family', points: round1(history.points), text: familyText(history) },
  ];
  const score = round1(factors.reduce((s, f) => s + f.points, 0));
  const range = { p10: Math.exp(fam.p10), med: Math.exp(fam.med), p90: Math.exp(fam.p90) };
  const conf = confidenceFor(est.evidence, range, year, w);
  const weakSpots = weakSpotsFor(
    {
      lake,
      species: ctx.species,
      speciesName: sp,
      primaryGear,
      evidence: est.evidence,
      confidence: conf.confidence,
      range,
      launch,
      towing: ctx.towing,
      driveMin,
      year,
    },
    w,
  );
  return {
    lake,
    launch,
    distanceKm: distanceKmToLaunch,
    driveMin,
    score,
    factors,
    range,
    confidence: conf.confidence,
    confidenceText: conf.text,
    weakSpots,
    usedFamilyLog: fam.used,
    fishPts: factors[0]!.points,
  };
}
