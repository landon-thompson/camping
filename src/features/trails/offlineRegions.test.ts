import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteOfflineRegion, listOfflineRegions, newOfflineRegionId, saveOfflineRegion, type OfflineRegion } from './offlineRegions';

const region = (over: Partial<OfflineRegion> = {}): OfflineRegion => ({
  id: 'region:1',
  tripId: 'trip:1',
  name: 'Trip area',
  bbox: [-92, 46, -91, 47],
  zooms: [11, 13],
  estTiles: 120,
  estBytes: 2_400_000,
  stopsCompleted: 4,
  stopsTotal: 4,
  createdAt: 1000,
  ...over,
});

describe('newOfflineRegionId', () => {
  it('produces distinct region:* ids', () => {
    const a = newOfflineRegionId();
    const b = newOfflineRegionId();
    expect(a).toMatch(/^region:/);
    expect(a).not.toBe(b);
  });
});

describe('offlineRegions storage', () => {
  it('starts empty', async () => {
    expect(await listOfflineRegions()).toEqual([]);
  });

  it('saves and lists a region', async () => {
    await saveOfflineRegion(region());
    const all = await listOfflineRegions();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('Trip area');
  });

  it('replaces a region with the same id instead of duplicating it', async () => {
    await saveOfflineRegion(region({ id: 'region:2', name: 'First' }));
    await saveOfflineRegion(region({ id: 'region:2', name: 'Updated' }));
    const all = await listOfflineRegions();
    const matches = all.filter((r) => r.id === 'region:2');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe('Updated');
  });

  it('deletes a region by id, leaving the others', async () => {
    await saveOfflineRegion(region({ id: 'region:3' }));
    await saveOfflineRegion(region({ id: 'region:4' }));
    await deleteOfflineRegion('region:3');
    const all = await listOfflineRegions();
    expect(all.find((r) => r.id === 'region:3')).toBeUndefined();
    expect(all.find((r) => r.id === 'region:4')).toBeDefined();
  });
});
