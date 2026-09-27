import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CampDB } from '../db/local';
import { SyncEngine } from './engine';
import { afterAccepted, afterRejected, mergeRemote, type LocalRecord, type RemoteRecord } from './merge';
// The real server-side store logic, so these tests prove both halves agree.
import { MemoryStore } from '../../api/src/lib/store';

const local = (over: Partial<LocalRecord> = {}): LocalRecord => ({
  id: 'a',
  type: 'gear',
  data: 'local',
  updatedAt: 100,
  updatedBy: 'u1',
  deleted: 0,
  dirty: 0,
  ...over,
});
const remote = (over: Partial<RemoteRecord> = {}): RemoteRecord => ({
  id: 'a',
  type: 'gear',
  data: 'remote',
  updatedAt: 100,
  updatedBy: 'u2',
  deleted: false,
  rev: '1',
  ...over,
});

describe('merge rules', () => {
  it('takes remote when nothing is pending locally', () => {
    expect(mergeRemote(undefined, remote())?.data).toBe('remote');
    expect(mergeRemote(local({ updatedAt: 999 }), remote())?.data).toBe('remote');
  });

  it('keeps a pending local edit that is at least as new', () => {
    expect(mergeRemote(local({ dirty: 1, updatedAt: 200 }), remote({ updatedAt: 100 }))).toBeNull();
    expect(mergeRemote(local({ dirty: 1, updatedAt: 100 }), remote({ updatedAt: 100 }))).toBeNull();
    expect(mergeRemote(local({ dirty: 1, updatedAt: 50 }), remote({ updatedAt: 100 }))?.data).toBe('remote');
  });

  it('clears dirty only if not edited while the push was in flight', () => {
    expect(afterAccepted(local({ dirty: 1, updatedAt: 100 }), 100)?.dirty).toBe(0);
    expect(afterAccepted(local({ dirty: 1, updatedAt: 150 }), 100)).toBeNull();
  });

  it('adopts the server copy on rejection unless edited again since', () => {
    expect(afterRejected(local({ dirty: 1 }), 100, remote({ updatedAt: 300 }))?.data).toBe('remote');
    expect(afterRejected(local({ dirty: 1, updatedAt: 400 }), 100, remote({ updatedAt: 300 }))).toBeNull();
  });
});

/** A fake `fetch` that routes /api/sync to the real MemoryStore. */
function fakeServer(store: MemoryStore, userId: string, opts: { status?: number } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (opts.status) return new Response(JSON.stringify({ error: 'nope' }), { status: opts.status, headers: { 'content-type': 'application/json' } });
    const url = new URL(String(input), 'http://x');
    let body: unknown;
    if (init?.method === 'POST') {
      body = await store.push('family', userId, JSON.parse(String(init.body)).records);
    } else {
      body = await store.pull('family', url.searchParams.get('since') ?? '0', Number(url.searchParams.get('limit') ?? 500));
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

let n = 0;
const freshDb = () => new CampDB(`test-${++n}`);

describe('SyncEngine end-to-end (two phones, one server)', () => {
  it('shares edits between phones and resolves conflicts by last write', async () => {
    const server = new MemoryStore();
    const phoneA = freshDb();
    const phoneB = freshDb();
    const syncA = new SyncEngine(phoneA, fakeServer(server, 'alice'));
    const syncB = new SyncEngine(phoneB, fakeServer(server, 'bob'));

    // Both phones seed the same record offline (timestamp 0).
    await phoneA.records.add(local({ id: 'settings', data: { budget: 3000 }, updatedAt: 0, dirty: 1 }));
    await phoneB.records.add(local({ id: 'settings', data: { budget: 3000 }, updatedAt: 0, dirty: 1 }));

    // Alice edits the budget; Bob adds a gear item.
    await phoneA.records.put(local({ id: 'settings', data: { budget: 4000 }, updatedAt: 1000, dirty: 1 }));
    await phoneB.records.add(local({ id: 'gear:1', data: { name: 'Fridge' }, updatedAt: 1100, dirty: 1 }));

    await syncA.sync();
    await syncB.sync();
    await syncA.sync();

    for (const phone of [phoneA, phoneB]) {
      expect((await phone.records.get('settings'))?.data).toEqual({ budget: 4000 });
      expect((await phone.records.get('gear:1'))?.data).toEqual({ name: 'Fridge' });
      expect(await phone.records.where('dirty').equals(1).count()).toBe(0);
    }
    expect(syncA.getStatus().state).toBe('synced');

    // Offline conflict: both edit the fridge; Bob's edit is later and wins everywhere.
    await phoneA.records.put(local({ id: 'gear:1', data: { name: 'Fridge A' }, updatedAt: 2000, dirty: 1 }));
    await phoneB.records.put(local({ id: 'gear:1', data: { name: 'Fridge B' }, updatedAt: 2500, dirty: 1 }));
    await syncB.sync();
    await syncA.sync(); // A's push is rejected and A adopts B's version
    expect((await phoneA.records.get('gear:1'))?.data).toEqual({ name: 'Fridge B' });
    expect((await phoneA.records.get('gear:1'))?.dirty).toBe(0);

    // Deletes sync as tombstones.
    await phoneA.records.put(local({ id: 'gear:1', data: { name: 'Fridge B' }, updatedAt: 3000, deleted: 1, dirty: 1 }));
    await syncA.sync();
    await syncB.sync();
    expect((await phoneB.records.get('gear:1'))?.deleted).toBe(1);
  });

  it('reports auth and availability problems without losing local edits', async () => {
    const phone = freshDb();
    await phone.records.add(local({ dirty: 1 }));
    for (const [status, state] of [
      [401, 'signed-out'],
      [403, 'not-invited'],
      [503, 'waking'],
      [500, 'error'],
    ] as const) {
      const engine = new SyncEngine(phone, fakeServer(new MemoryStore(), 'x', { status }));
      await engine.sync();
      expect(engine.getStatus()).toMatchObject({ state, pending: 1 });
    }
    const noDb = new SyncEngine(phone, (async () =>
      new Response(JSON.stringify({ error: 'Database not configured', code: 'not-configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch);
    await noDb.sync();
    expect(noDb.getStatus()).toMatchObject({ state: 'local-only', pending: 1 });
    const offline = new SyncEngine(phone, (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    await offline.sync();
    expect(offline.getStatus().state).toBe('offline');
    expect((await phone.records.get('a'))?.dirty).toBe(1);
  });
});
