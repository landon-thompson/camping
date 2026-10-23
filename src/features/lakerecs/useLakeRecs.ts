import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRecords } from '../../db/records';
import { LAKE_RADIUS_KM } from '../fishing/lakeSurvey';
import { contextKey, localDayKey, seedFor } from './daySeed';
import { ensureTilesFor, getStoredManifest, loadTiles } from './modelStore';
import { recommendLakes } from './rank';
import { tilesFor } from './tiles';
import type { RecContext, UseLakeRecs } from './types';
import { useLakeModelStatus } from './useLakeModelStatus';

/**
 * Ranked lakes for a campsite, from the tiles and fishing logs on the phone
 * (works offline). Thin wrapper around `recommendLakes`; pass null to idle.
 */
export function useLakeRecs(ctx: Omit<RecContext, 'seed'> | null): UseLakeRecs {
  const [roll, setRoll] = useState(0);
  const seed = seedFor(localDayKey(new Date()), roll);
  const key = contextKey(ctx);
  const lat = ctx?.origin.lat;
  const lng = ctx?.origin.lng;
  const radius = ctx?.radiusKm ?? LAKE_RADIUS_KM;

  const { update: _update, ...status } = useLakeModelStatus();
  // undefined while loading; null when no model is on the phone.
  const manifest = useLiveQuery(() => getStoredManifest(), [], undefined);
  const ids = useMemo(
    () => (manifest && lat != null && lng != null ? tilesFor({ lat, lng }, radius, manifest) : []),
    [manifest, lat, lng, radius],
  );
  const idsKey = ids.join(',');
  const tiles = useLiveQuery(() => loadTiles(ids), [idsKey], undefined);

  const logRows = useRecords('fishing_log');
  const logsKey = logRows.rows.map((r) => `${r.id}:${r.updatedAt}`).join('|');
  const logs = useMemo(() => logRows.rows.map((r) => r.data), [logsKey]);

  const result = useMemo(
    () => (ctx && manifest !== undefined && tiles !== undefined ? recommendLakes({ ...ctx, seed }, { tiles, logs, manifest }) : null),
    [key, seed, tiles, logs, manifest],
  );

  const download = useCallback(async () => {
    if (lat == null || lng == null) return;
    await ensureTilesFor({ lat, lng }, radius);
  }, [lat, lng, radius]);
  const rollAgain = useCallback(() => setRoll((r) => r + 1), []);

  const loading = !!ctx && (manifest === undefined || tiles === undefined || logRows.loading);
  return { loading, result, status, download, rollAgain };
}
