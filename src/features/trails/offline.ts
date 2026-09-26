/**
 * Thin browser-only driver for "prepare offline": pans/zooms a live MapLibre
 * map across a trip area at a few capped zooms so the tiles it requests get
 * cached by Workbox's runtime CacheFirst cache — see the `workbox` section
 * of vite.config.ts and docs/phase-4.md for why we drive real map views
 * instead of a scripted bulk tile downloader. Not unit tested here (needs a
 * live MapLibre/WebGL map); the tile math it's built on (`tiles.ts`) is.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { viewportStops, type BBox } from './tiles';

/**
 * Cache names Workbox's `runtimeCaching` uses for map tiles (see
 * vite.config.ts — keep these two literals in sync with the `cacheName`
 * values there). Exposed so "free up tile storage" can clear exactly these,
 * without touching the app-shell precache.
 */
export const MAP_TILE_CACHE_NAME = 'camp-planner-map-tiles';
export const MVUM_TILE_CACHE_NAME = 'camp-planner-mvum-tiles';

export interface PrepareOfflineOptions {
  map: MapLibreMap;
  bbox: BBox;
  zooms: readonly number[];
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** How many tiles wide/tall one camera stop's viewport should roughly cover. */
  viewportTiles?: number;
  /** Safety timeout per stop, in ms, in case a style/tile request hangs offline. */
  stopTimeoutMs?: number;
}

export interface PrepareOfflineResult {
  completedStops: number;
  totalStops: number;
  cancelled: boolean;
}

function waitForIdle(map: MapLibreMap, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off('idle', finish);
      resolve();
    };
    map.once('idle', finish);
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Jumps the camera to a small grid of stops covering `bbox` at each zoom,
 * waiting for the map to go idle (tiles loaded or failed) at each stop. Safe
 * to call offline — a stop that never loads just times out and moves on.
 */
export async function prepareOfflineByViewing(opts: PrepareOfflineOptions): Promise<PrepareOfflineResult> {
  const { map, bbox, zooms, onProgress, signal, viewportTiles = 4, stopTimeoutMs = 8000 } = opts;
  const stops = zooms.flatMap((z) => viewportStops(bbox, z, viewportTiles));
  const total = stops.length;
  const originalCenter = map.getCenter();
  const originalZoom = map.getZoom();

  let completed = 0;
  for (const stop of stops) {
    if (signal?.aborted) {
      return { completedStops: completed, totalStops: total, cancelled: true };
    }
    try {
      map.jumpTo({ center: [stop.lng, stop.lat], zoom: stop.zoom });
      await waitForIdle(map, stopTimeoutMs);
    } catch {
      // A single failed/offline stop shouldn't abort the whole pass.
    }
    completed++;
    onProgress?.(completed, total);
  }

  try {
    map.jumpTo({ center: originalCenter, zoom: originalZoom });
  } catch {
    // ignore — map may have been removed while this ran
  }

  return { completedStops: completed, totalStops: total, cancelled: false };
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
}

/** `navigator.storage.estimate()`, defensively — unsupported/blocked in some browsers/private modes. */
export async function storageEstimate(): Promise<StorageEstimate | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usageBytes: usage, quotaBytes: quota };
  } catch {
    return null;
  }
}

/**
 * Clears the whole map/MVUM tile caches (not just one region — see
 * docs/phase-4.md for why per-region eviction isn't precise with a
 * pan-driven "by viewing" cache instead of a tracked bulk download).
 */
export async function clearMapTileCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await Promise.allSettled([caches.delete(MAP_TILE_CACHE_NAME), caches.delete(MVUM_TILE_CACHE_NAME)]);
  } catch {
    // ignore — Cache API unavailable (e.g. private mode)
  }
}
