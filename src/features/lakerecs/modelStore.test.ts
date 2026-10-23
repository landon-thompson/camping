import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getMeta } from '../../db/local';
import { FIXTURE_ORIGIN, FIXTURE_RAW, fixtureManifest } from './fixtures/load';
import {
  CHECK_KEY,
  composeStatus,
  ensureTilesFor,
  getStoredManifest,
  getTileIndex,
  loadTiles,
  MANIFEST_KEY,
  modelStatus,
  refreshLakeModel,
  resetModelActivity,
  tileKey,
} from './modelStore';
import { createRefreshScheduler } from './refresh';
import type { ModelManifest } from './types';

const BASE = 'http://localhost/lake-model/';
type Route = string | (() => Response | Promise<Response>);

/** A fake static server: path under /lake-model/ → body. Records every URL asked for. */
function server(files: Record<string, Route>) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-cache' });
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const r = files[path];
    if (r === undefined) return new Response('Not found', { status: 404 });
    if (typeof r === 'function') return r();
    return new Response(r, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const fixtureServer = () => server({ ...FIXTURE_RAW });
const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A new model version: only the east tile, re-exported with the new version. */
async function version2(): Promise<Record<string, string>> {
  const east = JSON.parse(FIXTURE_RAW['tiles/t_47.5_-92.json']!);
  east.version = '2026.11.0-fixture';
  const text = JSON.stringify(east);
  const m = fixtureManifest();
  const ref = m.tiles.find((t) => t.id === 't_47.5_-92')!;
  const manifest: ModelManifest = {
    ...m,
    version: '2026.11.0-fixture',
    tiles: [{ ...ref, bytes: new TextEncoder().encode(text).length, sha256: await sha256Hex(text) }],
  };
  return { 'manifest.json': JSON.stringify(manifest), 'tiles/t_47.5_-92.json': text };
}

beforeEach(async () => {
  await db.meta.clear();
  resetModelActivity();
});

describe('manifest checks', () => {
  it('404 means "not published yet" (state none), nothing stored', async () => {
    const { fetchFn } = server({});
    const r = await refreshLakeModel(fetchFn);
    expect(r.status.state).toBe('none');
    expect(r.status.message).toBe('Lake model not published yet.');
    expect(await getStoredManifest()).toBeNull();
    expect(await getMeta(CHECK_KEY)).toBeTypeOf('number');
  });

  it('the single-page fallback (index.html with 200) also means not published', async () => {
    const { fetchFn } = server({ 'manifest.json': '<!doctype html><html><div id="root"></div></html>' });
    expect((await refreshLakeModel(fetchFn)).status.state).toBe('none');
  });

  it('a network failure is "offline" and is retried later (no check time saved)', async () => {
    const r = await refreshLakeModel(offline);
    expect(r.status.state).toBe('offline');
    expect(await getMeta(CHECK_KEY)).toBeUndefined();
  });

  it('a redirect (expired sign-in) is reported as offline with a sign-in hint', async () => {
    const { fetchFn } = server({ 'manifest.json': () => new Response(null, { status: 302, headers: { location: 'https://x.cloudflareaccess.com/' } }) });
    const r = await refreshLakeModel(fetchFn);
    expect(r.status).toMatchObject({ state: 'offline', message: 'Sign in again to update the lake model.' });
    const opaque = (() => Promise.resolve({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as Response)) as unknown as typeof fetch;
    expect((await refreshLakeModel(opaque)).status.state).toBe('offline');
  });

  it('non-JSON or a wrong format is an error, not a crash', async () => {
    expect((await refreshLakeModel(server({ 'manifest.json': '{oops' }).fetchFn)).status.state).toBe('error');
    expect((await refreshLakeModel(server({ 'manifest.json': '{"format":2}' }).fetchFn)).status.state).toBe('error');
    expect((await refreshLakeModel(server({ 'manifest.json': () => new Response('x', { status: 500 }) }).fetchFn)).status.state).toBe('error');
  });
});

describe('ensureTilesFor', () => {
  it('downloads the tiles a 25-mile circle needs, verifies them and reports what is missing', async () => {
    const { fetchFn, calls } = fixtureServer();
    const r = await ensureTilesFor(FIXTURE_ORIGIN, 40.2, fetchFn);
    expect(r.needed.sort()).toEqual(['t_47.5_-92', 't_47.5_-93', 't_48_-92']);
    expect(r.downloaded.sort()).toEqual(['t_47.5_-92', 't_47.5_-93']);
    expect(r.failed).toEqual([{ id: 't_48_-92', why: 'Tile t_48_-92 is missing on the server.' }]);
    expect(r.missing).toEqual(['t_48_-92']);
    expect(calls[0]).toBe(`${BASE}manifest.json`);
    expect(calls).toContain(`${BASE}tiles/t_47.5_-92.json`);

    const m = fixtureManifest();
    const bytes = m.tiles.filter((t) => t.id !== 't_48_-92').reduce((s, t) => s + t.bytes, 0);
    expect(r.status).toMatchObject({ version: m.version, tilesOnPhone: 2, bytesOnPhone: bytes });
    const tiles = await loadTiles(['t_47.5_-93', 'nope', 't_47.5_-92']);
    expect(tiles.map((t) => t.id)).toEqual(['t_47.5_-93', 't_47.5_-92']);

    // Second call: nothing new to download (works offline too).
    const again = await ensureTilesFor(FIXTURE_ORIGIN, 40.2, offline);
    expect(again.downloaded).toEqual([]);
    expect(again.missing).toEqual(['t_48_-92']);
  });

  it('rejects a tile whose sha256 does not match', async () => {
    const raw = FIXTURE_RAW['tiles/t_47.5_-92.json']!;
    const tampered = raw.replace('Fixture Lake Alpha', 'Fixture Lake Alphb'); // same length
    expect(tampered.length).toBe(raw.length);
    const { fetchFn } = server({ ...FIXTURE_RAW, 'tiles/t_47.5_-92.json': tampered });
    const r = await ensureTilesFor(FIXTURE_ORIGIN, 10, fetchFn);
    expect(r.failed).toEqual([{ id: 't_47.5_-92', why: 'Tile t_47.5_-92 failed its check.' }]);
    expect(await db.meta.get(tileKey('t_47.5_-92'))).toBeUndefined();
    expect(r.status.state).toBe('error');
  });

  it('rejects a tile of the wrong size', async () => {
    const { fetchFn } = server({ ...FIXTURE_RAW, 'tiles/t_47.5_-92.json': `${FIXTURE_RAW['tiles/t_47.5_-92.json']} ` });
    const r = await ensureTilesFor(FIXTURE_ORIGIN, 10, fetchFn);
    expect(r.failed[0]!.why).toBe('Tile t_47.5_-92 arrived incomplete.');
  });

  it('offline with nothing stored: reports offline, never throws', async () => {
    const r = await ensureTilesFor(FIXTURE_ORIGIN, 40.2, offline);
    expect(r).toMatchObject({ needed: [], downloaded: [], missing: [] });
    expect(r.status.state).toBe('offline');
  });

  it('parallel calls share one download per tile', async () => {
    const { fetchFn, calls } = fixtureServer();
    await Promise.all([ensureTilesFor(FIXTURE_ORIGIN, 10, fetchFn), ensureTilesFor(FIXTURE_ORIGIN, 10, fetchFn)]);
    expect(calls.filter((c) => c.endsWith('t_47.5_-92.json'))).toHaveLength(1);
  });
});

describe('refreshLakeModel', () => {
  it('same version: nothing refetched', async () => {
    const { fetchFn } = fixtureServer();
    await ensureTilesFor(FIXTURE_ORIGIN, 40.2, fetchFn);
    const second = fixtureServer();
    const r = await refreshLakeModel(second.fetchFn);
    expect(r).toMatchObject({ changed: false, refetched: [], dropped: [] });
    expect(second.calls).toEqual([`${BASE}manifest.json`]);
    expect(r.status.state).toBe('ready');
  });

  it('new version: refetches stored tiles and drops ones the model no longer lists', async () => {
    await ensureTilesFor(FIXTURE_ORIGIN, 40.2, fixtureServer().fetchFn);
    const v2 = server(await version2());
    const r = await refreshLakeModel(v2.fetchFn);
    expect(r).toMatchObject({ changed: true, refetched: ['t_47.5_-92'], dropped: ['t_47.5_-93'], failed: [] });
    expect((await getStoredManifest())!.version).toBe('2026.11.0-fixture');
    expect(Object.keys(await getTileIndex())).toEqual(['t_47.5_-92']);
    expect((await loadTiles(['t_47.5_-92']))[0]!.version).toBe('2026.11.0-fixture');
    expect(await db.meta.get(tileKey('t_47.5_-93'))).toBeUndefined();
    expect(r.status).toMatchObject({ state: 'ready', version: '2026.11.0-fixture', tilesOnPhone: 1 });
  });

  it('keeps the old copy when a refetch fails, and retries it next time', async () => {
    await ensureTilesFor(FIXTURE_ORIGIN, 10, fixtureServer().fetchFn);
    const files = await version2();
    const broken = server({ 'manifest.json': files['manifest.json']! }); // tile 404s
    const r = await refreshLakeModel(broken.fetchFn);
    expect(r.failed.map((f) => f.id)).toEqual(['t_47.5_-92']);
    expect((await loadTiles(['t_47.5_-92']))[0]!.version).toBe('2026.10.0-fixture');
    const fixed = await refreshLakeModel(server(files).fetchFn);
    expect(fixed.refetched).toEqual(['t_47.5_-92']);
  });

  it('a manifest that vanished from the server leaves the phone copy usable', async () => {
    await ensureTilesFor(FIXTURE_ORIGIN, 5, fixtureServer().fetchFn);
    const r = await refreshLakeModel(server({}).fetchFn);
    expect(r.status.state).toBe('ready');
    expect(await db.meta.get(MANIFEST_KEY)).toBeDefined();
    expect(r.status.tilesOnPhone).toBe(1);
  });
});

describe('status', () => {
  it('composes stored data with current activity', () => {
    const m = fixtureManifest();
    const idx = { a: { bytes: 10, sha256: '', version: m.version, storedAt: 0 }, b: { bytes: 5, sha256: '', version: m.version, storedAt: 0 } };
    expect(composeStatus(null, {}, { busy: false, problem: null })).toMatchObject({ state: 'none', tilesOnPhone: 0, bytesOnPhone: 0 });
    expect(composeStatus(null, {}, { busy: true, problem: null }).state).toBe('loading');
    expect(composeStatus(m, idx, { busy: true, problem: null }).state).toBe('updating');
    expect(composeStatus(m, idx, { busy: false, problem: null })).toMatchObject({ state: 'ready', version: m.version, createdAt: m.createdAt, tilesOnPhone: 2, bytesOnPhone: 15 });
    expect(composeStatus(m, idx, { busy: false, problem: { state: 'offline', message: 'x' } })).toMatchObject({ state: 'offline', tilesOnPhone: 2 });
    expect(composeStatus(m, idx, { busy: false, problem: { state: 'error', message: 'bad' } })).toMatchObject({ state: 'error', message: 'bad' });
  });

  it('modelStatus reads the phone', async () => {
    expect((await modelStatus()).state).toBe('none');
    await ensureTilesFor(FIXTURE_ORIGIN, 5, fixtureServer().fetchFn);
    expect(await modelStatus()).toMatchObject({ state: 'ready', tilesOnPhone: 1 });
  });
});

describe('refresh scheduler', () => {
  const make = (over: Partial<Parameters<typeof createRefreshScheduler>[0]> = {}) => {
    const state = { now: 1_000_000_000, online: true, last: null as number | null, refreshes: 0 };
    const s = createRefreshScheduler({
      now: () => state.now,
      online: () => state.online,
      lastCheck: async () => state.last,
      refresh: async () => {
        state.refreshes++;
        state.last = state.now;
      },
      ...over,
    });
    return { s, state };
  };

  it('refreshes at most once per 6 hours, only online', async () => {
    const { s, state } = make();
    expect(await s.poke()).toBe('refreshed');
    expect(await s.poke()).toBe('recent');
    state.now += 5 * 3600_000;
    expect(await s.poke()).toBe('recent');
    state.now += 3600_000 + 1;
    state.online = false;
    expect(await s.poke()).toBe('offline');
    state.online = true;
    expect(await s.poke()).toBe('refreshed');
    expect(state.refreshes).toBe(2);
  });

  it('respects a check made earlier (persisted), and never runs two at once', async () => {
    const { s, state } = make();
    state.last = state.now - 3600_000;
    expect(await s.poke()).toBe('recent');
    state.last = null;
    const [a, b] = await Promise.all([s.poke(), s.poke()]);
    expect([a, b].sort()).toEqual(['busy', 'refreshed']);
  });

  it('a failed refresh waits at least 5 minutes before trying again', async () => {
    let calls = 0;
    const { s, state } = make({
      refresh: async () => {
        calls++;
        throw new Error('boom');
      },
    });
    expect(await s.poke()).toBe('failed');
    state.now += 60_000;
    expect(await s.poke()).toBe('recent');
    state.now += 5 * 60_000;
    expect(await s.poke()).toBe('failed');
    expect(calls).toBe(2);
  });
});
