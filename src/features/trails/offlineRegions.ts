/**
 * On-phone bookkeeping for "prepare offline" regions. This is NOT a synced
 * record type (it's per-device cache bookkeeping, not trip data), so it
 * lives in the existing `db.meta` key/value table via `getMeta`/`setMeta`
 * rather than a new Dexie table or a `recordSchemas` entry.
 */
import { getMeta, setMeta } from '../../db/local';
import type { BBox } from './tiles';

const META_KEY = 'trails.offlineRegions';

export interface OfflineRegion {
  id: string;
  tripId: string | null;
  name: string;
  bbox: BBox;
  zooms: number[];
  estTiles: number;
  estBytes: number;
  stopsCompleted: number;
  stopsTotal: number;
  createdAt: number;
}

export async function listOfflineRegions(): Promise<OfflineRegion[]> {
  return (await getMeta<OfflineRegion[]>(META_KEY)) ?? [];
}

export async function saveOfflineRegion(region: OfflineRegion): Promise<void> {
  const all = await listOfflineRegions();
  await setMeta(META_KEY, [...all.filter((r) => r.id !== region.id), region]);
}

/** Local id, not a synced record id — offline regions are per-device bookkeeping only. */
export function newOfflineRegionId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `region:${rand}`;
}

export async function deleteOfflineRegion(id: string): Promise<void> {
  const all = await listOfflineRegions();
  await setMeta(
    META_KEY,
    all.filter((r) => r.id !== id),
  );
}
