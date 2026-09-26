import { useSyncExternalStore } from 'react';
import { db } from '../db/local';
import { SyncEngine, type SyncStatus } from './engine';
import { onLocalChange } from './signal';

export const syncEngine = new SyncEngine(db);

const DEBOUNCE_MS = 2_000;
const PERIODIC_MS = 5 * 60_000;
const WAKING_RETRY_MS = 20_000;

let started = false;

/** Wire up background sync: on start, on reconnect, on return to app, after edits. */
export function startSync(): void {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (ms = DEBOUNCE_MS) => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncEngine.sync(), ms);
  };

  onLocalChange(() => {
    void syncEngine.refreshPending();
    soon();
  });
  window.addEventListener('online', () => soon(0));
  window.addEventListener('offline', () => void syncEngine.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') soon(0);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncEngine.sync();
  }, PERIODIC_MS);
  // The database wakes from auto-pause within about a minute; try again then.
  syncEngine.subscribe(() => {
    if (syncEngine.getStatus().state === 'waking') soon(WAKING_RETRY_MS);
  });

  void syncEngine.refreshPending().then(() => syncEngine.sync());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getStatus);
}
