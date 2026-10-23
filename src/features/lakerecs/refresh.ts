import { getMeta } from '../../db/local';
import { syncEngine } from '../../sync/useSync';
import { CHECK_KEY, refreshLakeModel } from './modelStore';

/**
 * Background lake-model refresh: at app start, when the phone comes back
 * online, and after each successful sync, but at most once every 6 hours
 * (plus a 5-minute floor between attempts that didn't reach the server).
 * Subscribes to the sync status instead of changing the sync engine.
 */

export const REFRESH_EVERY_MS = 6 * 60 * 60_000;
export const RETRY_FLOOR_MS = 5 * 60_000;

export interface RefreshDeps {
  now(): number;
  online(): boolean;
  /** When the server was last asked (persisted), or null. */
  lastCheck(): Promise<number | null>;
  refresh(): Promise<unknown>;
  everyMs?: number;
  retryFloorMs?: number;
}

export type PokeResult = 'offline' | 'busy' | 'recent' | 'refreshed' | 'failed';

/** The rate-limit logic on its own, so it can be tested without timers or the sync engine. */
export function createRefreshScheduler(deps: RefreshDeps) {
  const every = deps.everyMs ?? REFRESH_EVERY_MS;
  const floor = deps.retryFloorMs ?? RETRY_FLOOR_MS;
  let running = false;
  let lastAttempt = -Infinity;
  return {
    async poke(): Promise<PokeResult> {
      if (!deps.online()) return 'offline';
      if (running) return 'busy';
      const now = deps.now();
      if (now - lastAttempt < floor) return 'recent';
      running = true;
      try {
        const last = await deps.lastCheck().catch(() => null);
        if (last != null && now - last < every) return 'recent';
        lastAttempt = now;
        await deps.refresh();
        return 'refreshed';
      } catch {
        return 'failed';
      } finally {
        running = false;
      }
    },
  };
}

let stopFn: (() => void) | null = null;

/**
 * Start background refreshes (idempotent). Call once at app start, next to
 * `startSync()` in App.tsx. Returns a stop function.
 */
export function startLakeModelRefresh(fetchFn: typeof fetch = (...a) => fetch(...a)): () => void {
  if (stopFn) return stopFn;
  const scheduler = createRefreshScheduler({
    now: () => Date.now(),
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    lastCheck: async () => (await getMeta<number>(CHECK_KEY)) ?? null,
    refresh: () => refreshLakeModel(fetchFn),
  });
  const poke = () => void scheduler.poke();

  let lastSynced = syncEngine.getStatus().lastSyncedAt;
  const unsubscribe = syncEngine.subscribe(() => {
    const s = syncEngine.getStatus();
    if (s.state === 'synced' && s.lastSyncedAt !== lastSynced) {
      lastSynced = s.lastSyncedAt;
      poke();
    }
  });
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) window.addEventListener('online', poke);
  // Let the app finish starting before the first check.
  const timer = setTimeout(poke, 3_000);

  stopFn = () => {
    unsubscribe();
    if (hasWindow) window.removeEventListener('online', poke);
    clearTimeout(timer);
    stopFn = null;
  };
  return stopFn;
}
