import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './local';
import { ensureSeeds } from './records';
import { SEED_RECORDS } from '../seed/seed';

describe('ensureSeeds', () => {
  beforeEach(async () => {
    await db.records.clear();
  });

  it('refreshes seeds nobody edited, keeps edited ones', async () => {
    await ensureSeeds();
    const [a, b] = SEED_RECORDS;
    await db.records.update(a!.id, { data: { stale: true } }); // old app version's seed text, never edited
    await db.records.update(b!.id, { data: { mine: true }, updatedAt: 123 }); // the family edited it
    expect(await ensureSeeds()).toBe(1);
    expect((await db.records.get(a!.id))?.data).toEqual(a!.data);
    expect((await db.records.get(b!.id))?.data).toEqual({ mine: true });
    expect(await ensureSeeds()).toBe(0);
  });
});
