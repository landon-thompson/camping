import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { Button, Card } from '../../components/ui';
import { useRecords } from '../../db/records';
import type { Route } from '../../model/trails';
import { clearMapTileCache, prepareOfflineByViewing, storageEstimate, type StorageEstimate } from './offline';
import { deleteOfflineRegion, listOfflineRegions, newOfflineRegionId, saveOfflineRegion, type OfflineRegion } from './offlineRegions';
import { bboxFromPoints, clampZoomsToBudget, formatBytes, OFFLINE_ZOOM_LEVELS, type BBox } from './tiles';

function routeGeometryPoints(route: Route): { lat: number; lng: number }[] {
  const parts = route.geometry.type === 'LineString' ? [route.geometry.coordinates] : route.geometry.coordinates;
  const points: { lat: number; lng: number }[] = [];
  for (const part of parts) {
    for (const c of part) points.push({ lat: c[1] ?? 0, lng: c[0] ?? 0 });
  }
  return points;
}

export interface OfflinePanelProps {
  tripId: string | null;
  /** The live map from TrailsMap, once it's loaded — panning drives the "prepare offline" pass. */
  map: MapLibreMap | null;
  tripLocation?: { lat: number; lng: number } | null;
}

/**
 * Tile policy (see docs/phase-4.md): OpenFreeMap's public terms don't clearly
 * permit a scripted bulk region download, so we don't build one. Instead we
 * pan/zoom the trip area at a few capped zooms so tiles get cached "by
 * viewing" through the normal Workbox runtime cache.
 */
export function OfflinePanel({ tripId, map, tripLocation }: OfflinePanelProps) {
  const { rows: routeRows } = useRecords('route');
  const { rows: pinRows } = useRecords('pin');
  const routes = routeRows.filter((r) => (tripId ? r.data.tripId === tripId : true));
  const pins = pinRows.filter((p) => (tripId ? p.data.tripId === tripId : true));

  const bbox = useMemo<BBox | null>(() => {
    const points = [
      ...(tripLocation ? [tripLocation] : []),
      ...pins.map((p) => p.data.position),
      ...routes.flatMap((r) => routeGeometryPoints(r.data)),
    ];
    return bboxFromPoints(points);
  }, [routes, pins, tripLocation]);

  const clamped = useMemo(() => (bbox ? clampZoomsToBudget(bbox, OFFLINE_ZOOM_LEVELS) : null), [bbox]);

  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function refresh() {
    setRegions(await listOfflineRegions());
    setStorage(await storageEstimate());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function start() {
    if (!map || !bbox || !clamped) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPreparing(true);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await prepareOfflineByViewing({
        map,
        bbox,
        zooms: clamped.zooms,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      await saveOfflineRegion({
        id: newOfflineRegionId(),
        tripId,
        name: tripLocation?.lat ? 'Trip area' : 'Imported routes/pins area',
        bbox,
        zooms: clamped.zooms,
        estTiles: clamped.totalTiles,
        estBytes: clamped.estBytes,
        stopsCompleted: result.completedStops,
        stopsTotal: result.totalStops,
        createdAt: Date.now(),
      });
      await refresh();
    } finally {
      setPreparing(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  async function removeRegion(id: string) {
    await deleteOfflineRegion(id);
    await refresh();
  }

  async function clearAll() {
    await clearMapTileCache();
    for (const r of regions) await deleteOfflineRegion(r.id);
    await refresh();
  }

  return (
    <Card title="Offline map">
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          We don't bulk-download map tiles — OpenFreeMap's public terms don't clearly allow that (see docs/phase-4.md). Instead,
          "prepare offline" pans the map across your trip area at a few zoom levels so those tiles get cached on this phone, the
          same as if you'd viewed them. The <strong>MVUM overlay is a convenience layer — the printed/official MVUM is the legal
          reference</strong> and isn't guaranteed to be cached offline.
        </p>

        {!bbox && <p className="text-sm text-ink-2">Import routes/pins (or set a trip location) first, so there's an area to prepare.</p>}

        {bbox && clamped && (
          <div className="rounded-xl border border-line p-3 text-sm">
            <p>
              Estimated <strong>{clamped.totalTiles.toLocaleString()}</strong> tiles (~{formatBytes(clamped.estBytes)}) across
              zoom levels {clamped.zooms.join(', ')}.
            </p>
            {!map && <p className="mt-1 text-ink-2">Waiting for the map to load…</p>}
          </div>
        )}

        {preparing ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-2">
              Preparing… {progress ? `${progress.done} / ${progress.total} stops` : 'starting'}
            </p>
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button onClick={() => void start()} disabled={!map || !bbox}>
            Prepare this area for offline
          </Button>
        )}

        {storage && (
          <p className="text-xs text-ink-2">
            This phone is using {formatBytes(storage.usageBytes)} of {formatBytes(storage.quotaBytes)} available storage.
          </p>
        )}

        {regions.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink-2">Saved offline areas</h3>
            <ul className="space-y-1">
              {regions.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-line p-2 text-sm">
                  <span>
                    {r.name} — ~{r.estTiles.toLocaleString()} tiles ({formatBytes(r.estBytes)}), zooms {r.zooms.join(', ')},{' '}
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                  <Button variant="ghost" className="text-bad" onClick={() => void removeRegion(r.id)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={() => void clearAll()}>
              Free up tile storage (clears all cached map tiles)
            </Button>
            <p className="text-xs text-ink-2">
              Deleting a saved area removes it from this list; "free up tile storage" clears every cached map tile at once — we
              can't yet evict just one area's tiles without re-downloading anything (see docs/phase-4.md).
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
