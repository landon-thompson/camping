import { describe, expect, it } from 'vitest';
import type { FishingLog } from '../../model/lakerecs';
import { FIXTURE_ORIGIN, fixtureManifest, fixtureTiles } from './fixtures/load';
import {
  driveMinutes,
  drivePoints,
  familyHistory,
  fishPoints,
  lakeSeed,
  launchPoints,
  mulberry32,
  pickLaunch,
  recommendLakes,
  seasonFit,
  type RecData,
} from './rank';
import type { ModelTile, RankMode, RecContext, TileLaunch } from './types';
import { DEFAULT_WEIGHTS } from './weights';

const NOW = new Date('2026-10-01T12:00:00Z');
const ctx = (over: Partial<RecContext> = {}): RecContext => ({
  origin: FIXTURE_ORIGIN,
  species: 'WAE',
  mode: 'expected',
  startDate: '2027-06-05',
  endDate: '2027-06-09',
  towing: true,
  seed: 1,
  ...over,
});
const data = (over: Partial<RecData> = {}): RecData => ({ tiles: fixtureTiles(), logs: [], manifest: fixtureManifest(), ...over });
const run = (c: Partial<RecContext> = {}, d: Partial<RecData> = {}) => recommendLakes(ctx(c), data(d), { now: NOW });
const names = (r: ReturnType<typeof run>) => r.recs.map((x) => x.lake.name.replace('Fixture Lake ', ''));
const launch = (rampClass: TileLaunch['rampClass'], lat = 47.9, lng = -91.8): TileLaunch => ({ name: rampClass, lat, lng, ramp: rampClass, rampClass, source: 'test' });

const log = (over: Partial<FishingLog>): FishingLog => ({
  lakeKey: 'mn:99000002',
  lakeName: 'Fixture Lake Bravo',
  tripId: null,
  date: '2026-06-10',
  hours: 4,
  anglers: 2,
  catches: [],
  targetSpecies: ['WAE'],
  rating: null,
  notes: '',
  ...over,
});

describe('score terms', () => {
  it('fish: +10 per doubling vs. a typical lake', () => {
    expect(fishPoints(Math.log(2))).toBeCloseTo(10, 12);
    expect(fishPoints(Math.log(4))).toBeCloseTo(20, 12);
    expect(fishPoints(0)).toBe(0);
    expect(fishPoints(Math.log(0.5))).toBeCloseTo(-10, 12);
    expect(fishPoints(Math.log(1.8))).toBeCloseTo(8.48, 2);
  });

  it('drive: km × 1.35 ÷ 70 km/h, −1 per 5 min beyond 10', () => {
    expect(driveMinutes(70 / 1.35)).toBeCloseTo(60, 10);
    expect(driveMinutes(10)).toBeCloseTo(11.571, 3);
    expect(drivePoints(5)).toBe(-0);
    expect(drivePoints(10)).toBe(-0);
    expect(drivePoints(25)).toBeCloseTo(-3, 12);
    expect(drivePoints(40)).toBeCloseTo(-6, 12);
  });

  it('launch: concrete 0 / gravel −2 / unknown −3 / carry-in −15 when towing, 0 otherwise', () => {
    expect(['concrete', 'gravel', 'unknown', 'carry-in'].map((c) => launchPoints(launch(c as TileLaunch['rampClass']), true))).toEqual([0, -2, -3, -15]);
    expect(['concrete', 'gravel', 'unknown', 'carry-in'].map((c) => launchPoints(launch(c as TileLaunch['rampClass']), false))).toEqual([0, 0, 0, 0]);
    expect(launchPoints(null, true)).toBe(0);
  });

  it('season: averages the estimate table over the trip days', () => {
    expect(seasonFit('WAE', '2027-06-05', '2027-06-09')).toEqual({ points: 3, when: 'Early June', hasRow: true });
    // 2 days in May (+2), 2 in June (+3)
    expect(seasonFit('WAE', '2027-05-30', '2027-06-02').points).toBeCloseTo(2.5, 12);
    expect(seasonFit('WAE', '2027-08-18', null)).toEqual({ points: -1, when: 'Mid August', hasRow: true });
    expect(seasonFit('WAE', null, null)).toEqual({ points: 0, when: null, hasRow: true });
    expect(seasonFit('XYZ', '2027-06-05', '2027-06-09')).toEqual({ points: 0, when: 'Early June', hasRow: false });
    // End before start → just the start day.
    expect(seasonFit('WAE', '2027-06-25', '2027-06-01')).toEqual({ points: 3, when: 'Late June', hasRow: true });
  });

  it('season table stays within ±5 and is labelled as an estimate', () => {
    for (const row of Object.values(DEFAULT_WEIGHTS.season)) {
      expect(row.status).toBe('estimate');
      expect(row.note.length).toBeGreaterThan(10);
      expect(row.months).toHaveLength(12);
      for (const v of row.months) expect(Math.abs(v)).toBeLessThanOrEqual(5);
    }
    for (const r of Object.values(DEFAULT_WEIGHTS.catchRatePerHour)) expect(r.status).toBe('estimate');
  });

  it('family: 0…+4 from the newest three ratings at this lake', () => {
    const at = (rating: number | null, date = '2026-06-10', lakeKey = 'mn:99000002') => log({ rating, date, lakeKey });
    expect(familyHistory([], 'mn:99000002').points).toBe(0);
    expect(familyHistory([at(5)], 'mn:99000002')).toEqual({ points: 4, ratings: [5], average: 5 });
    expect(familyHistory([at(3)], 'mn:99000002').points).toBeCloseTo(4 / 3, 12);
    expect(familyHistory([at(1), at(2)], 'mn:99000002').points).toBe(0);
    expect(familyHistory([at(null), at(5, '2026-06-10', 'mn:99000001')], 'mn:99000002').points).toBe(0);
    // Newest three only: the old 1/5 drops out.
    const h = familyHistory([at(1, '2020-01-01'), at(5, '2026-01-01'), at(5, '2025-01-01'), at(5, '2024-01-01')], 'mn:99000002');
    expect(h.points).toBe(4);
    expect(h.ratings).toEqual([5, 5, 5, 1]);
  });
});

describe('recommendLakes', () => {
  it('score is the sum of the factor points, ranks are 1..n', () => {
    for (const mode of ['safe', 'expected', 'adventurous'] as RankMode[]) {
      const r = run({ mode });
      expect(r.recs.map((x) => x.rank)).toEqual(r.recs.map((_, i) => i + 1));
      for (const rec of r.recs) {
        expect(rec.factors.map((f) => f.key)).toEqual(['fish', 'drive', 'launch', 'season', 'family']);
        expect(rec.score).toBeCloseTo(rec.factors.reduce((s, f) => s + f.points, 0), 9);
      }
      for (let i = 1; i < r.recs.length; i++) expect(r.recs[i - 1]!.score).toBeGreaterThanOrEqual(r.recs[i]!.score);
    }
  });

  it('expected scores Bravo by hand: 14.4 fish − 2.4 drive − 2 gravel + 3 season', () => {
    const bravo = run().recs.find((x) => x.lake.key === 'mn:99000002')!;
    // med θ = 1.0 → 10 / ln 2 = 14.43; 18.9 km × 1.35 ÷ 70 × 60 = 21.9 min → −2.37
    expect(bravo.factors.map((f) => f.points)).toEqual([14.4, -2.4, -2, 3, 0]);
    expect(bravo.score).toBe(13);
    expect(bravo.driveMin).toBeCloseTo(21.87, 1);
    expect(bravo.range.med).toBeCloseTo(Math.E, 12);
  });

  it('safe bet favours the sure thing, best expected the high middle guess', () => {
    expect(names(run({ mode: 'safe' }))).toEqual(['Alpha', 'Golf', 'Foxtrot', 'Bravo']);
    expect(names(run({ mode: 'expected' }))).toEqual(['Bravo', 'Alpha', 'Golf', 'Foxtrot']);
  });

  it('adventurous is deterministic per seed and rolls differently across seeds', () => {
    const a = run({ mode: 'adventurous', seed: 1 });
    expect(run({ mode: 'adventurous', seed: 1 })).toEqual(a);
    const orders = new Set<string>();
    let bravoFirst = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n = names(run({ mode: 'adventurous', seed }));
      orders.add(n.join(','));
      if (n[0] === 'Bravo') bravoFirst++;
    }
    expect(orders.size).toBeGreaterThan(2);
    // The uncertain-but-promising lake rises sometimes, not always.
    expect(bravoFirst).toBeGreaterThan(3);
    expect(bravoFirst).toBeLessThan(37);
  });

  it('per-lake draws do not depend on tile order', () => {
    const fwd = run({ mode: 'adventurous', seed: 7 });
    const rev = run({ mode: 'adventurous', seed: 7 }, { tiles: fixtureTiles().reverse() });
    expect(names(rev)).toEqual(names(fwd));
    expect(rev.recs.map((r) => r.score)).toEqual(fwd.recs.map((r) => r.score));
  });

  it('towing drops carry-in-only lakes and picks the nearest trailer ramp', () => {
    const towing = run({ towing: true });
    expect(towing.excluded).toContainEqual({ name: 'Fixture Lake Charlie', why: "carry-in access only (you're towing)" });
    expect(towing.recs.find((r) => r.lake.name === 'Fixture Lake Golf')!.launch!.name).toBe('Golf Public Ramp');

    const noTow = run({ towing: false });
    const charlie = noTow.recs.find((r) => r.lake.name === 'Fixture Lake Charlie')!;
    expect(charlie.launch!.rampClass).toBe('carry-in');
    expect(charlie.factors.find((f) => f.key === 'launch')!.points).toBe(0);
    expect(charlie.weakSpots).toContain('Carry-in access only');
    expect(noTow.recs.find((r) => r.lake.name === 'Fixture Lake Golf')!.launch!.name).toBe('Golf Canoe Access');
  });

  it('pickLaunch returns null when only carry-in exists and towing', () => {
    expect(pickLaunch([launch('carry-in')], FIXTURE_ORIGIN, true)).toBeNull();
    expect(pickLaunch([launch('carry-in')], FIXTURE_ORIGIN, false)!.rampClass).toBe('carry-in');
  });

  it('lists excluded lakes with reasons and missing tiles', () => {
    const r = run();
    expect(r.excluded).toEqual([
      { name: 'Fixture Lake Charlie', why: "carry-in access only (you're towing)" },
      { name: 'Fixture Lake Delta', why: 'no estimate for walleye' },
      { name: 'Fixture Lake Hotel', why: 'a bit too far (27 mi)' },
      { name: 'Fixture Lake India', why: 'no public launch listed' },
    ]);
    // Echo (≈70 km) is simply out of range.
    expect(r.excluded.some((e) => e.name.includes('Echo'))).toBe(false);
    expect(r.missingTiles).toEqual(['t_48_-92']);
    expect(r.modelVersion).toBe('2026.10.0-fixture');

    const bluegill = run({ species: 'BLG' });
    expect(names(bluegill)).toEqual(['Delta']);
    expect(bluegill.excluded).toContainEqual({ name: 'Fixture Lake Alpha', why: 'no estimate for bluegill' });
  });

  it('reports every needed tile missing when none are on the phone, and copes without a manifest', () => {
    const none = run({}, { tiles: [] });
    expect(none.recs).toEqual([]);
    expect(none.missingTiles.sort()).toEqual(['t_47.5_-92', 't_47.5_-93', 't_48_-92']);
    const noManifest = run({}, { manifest: null });
    expect(noManifest.missingTiles).toEqual([]);
    expect(noManifest.modelVersion).toBe('2026.10.0-fixture');
    expect(names(noManifest)).toEqual(names(run()));
  });

  it('respects radiusKm', () => {
    const r = run({ radiusKm: 10, towing: false });
    expect(names(r)).toEqual(['Charlie', 'Alpha']); // Charlie has more walleye; carry-in is fine without the trailer
  });

  it('breaks ties by fish points, drive, then name', () => {
    const tiles = fixtureTiles();
    const alpha = tiles[0]!.lakes[0]!;
    const twin = { ...alpha, key: 'mn:99000010', name: 'Fixture Lake Aardvark' };
    const extra: ModelTile = { ...tiles[0]!, id: 't_extra', lakes: [twin] };
    const r1 = run({}, { tiles: [...tiles, extra] });
    const r2 = run({}, { tiles: [extra, ...tiles] });
    expect(names(r1)).toEqual(names(r2));
    const i = names(r1).indexOf('Aardvark');
    expect(names(r1)[i + 1]).toBe('Alpha');
  });

  it('applies the family log: a skunked lake drops, a loved lake gets its bonus', () => {
    const skunk = Array.from({ length: 5 }, () => log({ hours: 6 }));
    const r = run({}, { logs: skunk });
    const bravo = r.recs.find((x) => x.lake.key === 'mn:99000002')!;
    expect(bravo.usedFamilyLog).toBe(true);
    expect(bravo.range.med).toBeLessThan(Math.E);
    expect(names(r)[0]).toBe('Alpha');
    expect(run().recs.every((x) => !x.usedFamilyLog)).toBe(true);

    const loved = run({}, { logs: [log({ lakeKey: 'mn:99000007', lakeName: 'Fixture Lake Golf', rating: 5, targetSpecies: [], catches: [] })] });
    const golf = loved.recs.find((x) => x.lake.key === 'mn:99000007')!;
    expect(golf.factors.find((f) => f.key === 'family')).toEqual({ key: 'family', points: 4, text: 'You rated it 5/5 last time' });
    // A rating alone (no target, no catch) says nothing about the fish.
    expect(golf.usedFamilyLog).toBe(false);
  });

  it('ignores trip dates when there are none', () => {
    const r = run({ startDate: null, endDate: null });
    for (const rec of r.recs) expect(rec.factors.find((f) => f.key === 'season')).toEqual({ key: 'season', points: 0, text: "No trip dates, so season isn't counted" });
  });

  it('never throws on thin or damaged tiles', () => {
    const tiles = fixtureTiles();
    const broken = JSON.parse(JSON.stringify(tiles[0])) as ModelTile;
    broken.id = 't_broken';
    broken.scale = {};
    broken.lakes = [
      { ...broken.lakes[0]!, key: 'mn:99000020', name: 'Fixture Lake Broken', sp: { WAE: { ...broken.lakes[0]!.sp.WAE!, q: '@@@' } } },
      { ...broken.lakes[1]!, key: 'mn:99000021', name: 'Fixture Lake Nan', sp: { WAE: { ...broken.lakes[1]!.sp.WAE!, med: Number.NaN } } },
    ];
    for (const mode of ['safe', 'expected', 'adventurous'] as RankMode[]) {
      const r = run({ mode }, { tiles: [broken] });
      expect(names(r)).toEqual(['Broken']);
      expect(Number.isFinite(r.recs[0]!.score)).toBe(true);
      expect(r.excluded).toContainEqual({ name: 'Fixture Lake Nan', why: 'no estimate for walleye' });
    }
  });
});

describe('seeded randomness', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('lakeSeed differs by lake, species and seed', () => {
    const s = lakeSeed(1, 'mn:99000001', 'WAE');
    expect(lakeSeed(1, 'mn:99000001', 'WAE')).toBe(s);
    expect(new Set([s, lakeSeed(2, 'mn:99000001', 'WAE'), lakeSeed(1, 'mn:99000002', 'WAE'), lakeSeed(1, 'mn:99000001', 'NOP')]).size).toBe(4);
  });
});
