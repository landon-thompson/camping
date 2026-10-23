import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { composeStatus, getModelActivity, getStoredManifest, getTileIndex, refreshLakeModel, subscribeModelActivity } from './modelStore';
import type { LakeModelStatus } from './types';

const LOADING: LakeModelStatus = { state: 'loading', version: null, createdAt: null, tilesOnPhone: 0, bytesOnPhone: 0 };

/**
 * Lake model status for the UI. `state: 'offline' | 'error'` doesn't mean the
 * recommender is unusable: whenever `tilesOnPhone > 0` it ranks from the copy
 * on the phone. `update()` checks the server now (ignores the 6-hour limit).
 */
export function useLakeModelStatus(): LakeModelStatus & { update(): Promise<void> } {
  const activity = useSyncExternalStore(subscribeModelActivity, getModelActivity);
  const stored = useLiveQuery(async () => ({ manifest: await getStoredManifest(), index: await getTileIndex() }), [], null);
  const update = useCallback(async () => {
    await refreshLakeModel();
  }, []);
  return useMemo(() => ({ ...(stored ? composeStatus(stored.manifest, stored.index, activity) : LOADING), update }), [stored, activity, update]);
}
