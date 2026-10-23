import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/local';
import type { FishingLog } from '../../model/lakerecs';
import { contextKey, localDayKey, seedFor } from './daySeed';
import { FIXTURE_ORIGIN, FIXTURE_RAW, fixtureManifest, fixtureTiles } from './fixtures/load';
import { ensureTilesFor, getStoredManifest, loadTiles, resetModelActivity, tilesFor } from './modelStore';
import { recommendLakes } from './rank';
import { startLakeModelRefresh } from './refresh';
import { saveFishingLog } from './saveFishingLog';

beforeEach(async () => {
  await db.meta.clear();
  await db.records.clear();
  resetModelActivity();
});

describe('seeds', () => {
  it('one seed per local day, a new one per roll', () => {
    expect(localDayKey(new Date(2027, 5, 5, 23, 59))).toBe(20270605);
    const day = 20270605;
    expect(seedFor(day, 0)).toBe(seedFor(day, 0));
    const seeds = new Set([seedFor(day, 0), seedFor(day, 1), seedFor(day, 2), seedFor(day + 1, 0)]);
    expect(seeds.size).toBe(4);
    for (const s of seeds) expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
  });

  it('contextKey ignores object identity but not values', () => {
    const c = { origin: { lat: 47.9, lng: -91.87 }, species: 'WAE', mode: 'safe' as const, startDate: null, endDate: null, towing: true };
    expect(contextKey({ ...c, origin: { ...c.origin } })).toBe(contextKey(c));
    expect(contextKey({ ...c, towing: false })).not.toBe(contextKey(c));
    expect(contextKey(null)).toBe('');
  });
});

describe('offline use', () => {
  it('ranks from what is stored on the phone with the network gone', async () => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const path = String(input).replace('http://localhost/lake-model/', '');
      const raw = FIXTURE_RAW[path];
      return raw ? new Response(raw) : new Response('', { status: 404 });
    }) as typeof fetch;
    await ensureTilesFor(FIXTURE_ORIGIN, 40.2, fetchFn);

    // From here on, no network at all: everything comes from db.meta.
    const manifest = await getStoredManifest();
    const tiles = await loadTiles(tilesFor(FIXTURE_ORIGIN, 40.2, manifest));
    const ctx = { origin: FIXTURE_ORIGIN, species: 'WAE', mode: 'expected' as const, startDate: '2027-06-05', endDate: '2027-06-09', towing: true, seed: 3 };
    const now = { now: new Date('2026-10-01') };
    const fromPhone = recommendLakes(ctx, { tiles, logs: [], manifest }, now);
    const direct = recommendLakes(ctx, { tiles: fixtureTiles(), logs: [], manifest: fixtureManifest() }, now);
    expect(fromPhone).toEqual(direct);
    expect(fromPhone.missingTiles).toEqual(['t_48_-92']);
  });
});

describe('saveFishingLog', () => {
  const log: FishingLog = {
    lakeKey: 'mn:99000001',
    lakeName: 'Fixture Lake Alpha',
    tripId: null,
    date: '2027-06-06',
    hours: 3,
    anglers: 2,
    catches: [{ species: 'WAE', count: 2 }],
    targetSpecies: ['WAE'],
    rating: 5,
    notes: '',
  };

  it('stores one record per outing and returns its id', async () => {
    const id = await saveFishingLog(log);
    expect(id).toMatch(/^fishing_log:/);
    const row = await db.records.get(id);
    expect(row).toMatchObject({ type: 'fishing_log', data: log, dirty: 1, deleted: 0 });
    expect(await saveFishingLog(log)).not.toBe(id);
  });

  it('rejects an invalid log', async () => {
    await expect(saveFishingLog({ ...log, lakeKey: 'nope' })).rejects.toThrow();
  });
});

describe('startLakeModelRefresh', () => {
  it('is idempotent and stoppable', () => {
    const stop = startLakeModelRefresh((() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch);
    expect(startLakeModelRefresh()).toBe(stop);
    stop();
    const again = startLakeModelRefresh();
    expect(again).not.toBe(stop);
    again();
  });
});
