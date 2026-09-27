import type { CampDB } from '../db/local';
import { afterAccepted, afterRejected, mergeRemote, type LocalRecord, type RemoteRecord } from './merge';

export type SyncState =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'signed-out'
  | 'not-invited'
  /** Azure SQL free tier pauses when idle; the first request wakes it (~1 min). */
  | 'waking'
  /** `npm run dev` without the API: everything stays on this device. */
  | 'local-only'
  | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt: number | null;
  message?: string;
}

interface PullResponse {
  records: RemoteRecord[];
  cursor: string;
  more: boolean;
}

interface PushResponse {
  accepted: { id: string; rev: string }[];
  rejected: RemoteRecord[];
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason from the API, e.g. 'not-configured'. */
    public code?: string,
  ) {
    super(message);
  }
}

const PUSH_BATCH = 100;
const CURSOR_KEY = 'sync.cursor';
const LAST_SYNC_KEY = 'sync.lastSyncedAt';

export class SyncEngine {
  private status: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private db: CampDB,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  getStatus = (): SyncStatus => this.status;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  /** No sync server at all (preview build): report that and never call the API. */
  setLocalOnly(): void {
    this.set({ state: 'local-only' });
  }

  async refreshPending(): Promise<void> {
    const [pending, last] = await Promise.all([
      this.db.records.where('dirty').equals(1).count(),
      this.db.meta.get(LAST_SYNC_KEY),
    ]);
    this.set({ pending, lastSyncedAt: (last?.value as number | undefined) ?? this.status.lastSyncedAt });
  }

  /** Run one push+pull. Concurrent calls coalesce into one follow-up run. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runOnce(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.refreshPending();
      this.set({ state: 'offline' });
      return;
    }
    this.set({ state: 'syncing', message: undefined });
    try {
      await this.push();
      await this.pull();
      const now = Date.now();
      await this.db.meta.put({ key: LAST_SYNC_KEY, value: now });
      await this.refreshPending();
      this.set({ state: 'synced', lastSyncedAt: now });
    } catch (e) {
      await this.refreshPending();
      this.set(this.errorStatus(e));
    }
  }

  private errorStatus(e: unknown): Partial<SyncStatus> {
    if (e instanceof HttpError) {
      if (e.status === 401) return { state: 'signed-out' };
      if (e.status === 403) return { state: 'not-invited', message: e.message };
      if (e.status === 404) return { state: 'local-only' };
      if (e.status === 503 && e.code === 'not-configured') return { state: 'local-only' };
      if (e.status === 503) return { state: 'waking', message: e.message };
      return { state: 'error', message: e.message };
    }
    // fetch() throws TypeError on network failure — treat as offline.
    if (e instanceof TypeError) return { state: 'offline' };
    return { state: 'error', message: e instanceof Error ? e.message : String(e) };
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    const type = res.headers.get('content-type') ?? '';
    // In `npm run dev` Vite answers unknown URLs with index.html.
    if (res.ok && !type.includes('json')) throw new HttpError(404, 'No sync server');
    if (!res.ok) {
      let msg = res.statusText;
      let code: string | undefined;
      try {
        const body = (await res.json()) as { error?: string; code?: string };
        if (body.error) msg = body.error;
        code = body.code;
      } catch {
        /* not JSON */
      }
      throw new HttpError(res.status, msg, code);
    }
    return (await res.json()) as T;
  }

  private async push(): Promise<void> {
    for (;;) {
      const batch = await this.db.records.where('dirty').equals(1).limit(PUSH_BATCH).toArray();
      if (batch.length === 0) return;
      const sent = new Map(batch.map((r) => [r.id, r.updatedAt]));
      const res = await this.request<PushResponse>('/api/sync', {
        method: 'POST',
        body: JSON.stringify({
          records: batch.map((r) => ({
            id: r.id,
            type: r.type,
            data: r.data,
            updatedAt: r.updatedAt,
            deleted: r.deleted === 1,
          })),
        }),
      });
      await this.db.transaction('rw', this.db.records, async () => {
        for (const a of res.accepted) {
          const next = afterAccepted(await this.db.records.get(a.id), sent.get(a.id) ?? -1);
          if (next) await this.db.records.put(next);
        }
        for (const s of res.rejected) {
          const next = afterRejected(await this.db.records.get(s.id), sent.get(s.id) ?? -1, s);
          if (next) await this.db.records.put(next);
        }
      });
      // Anything still dirty from this batch was edited mid-flight; the next
      // loop picks it up. Stop if the server made no progress, to avoid spinning.
      const handled = res.accepted.length + res.rejected.length;
      if (handled === 0) throw new Error('Server did not accept any changes');
      if (batch.length < PUSH_BATCH) return;
    }
  }

  private async pull(): Promise<void> {
    let cursor = ((await this.db.meta.get(CURSOR_KEY))?.value as string | undefined) ?? '0';
    for (;;) {
      const res = await this.request<PullResponse>(`/api/sync?since=${encodeURIComponent(cursor)}&limit=500`);
      await this.db.transaction('rw', this.db.records, this.db.meta, async () => {
        for (const remote of res.records) {
          const local: LocalRecord | undefined = await this.db.records.get(remote.id);
          const next = mergeRemote(local, remote);
          if (next) await this.db.records.put(next);
        }
        await this.db.meta.put({ key: CURSOR_KEY, value: res.cursor });
      });
      cursor = res.cursor;
      if (!res.more) return;
    }
  }
}
