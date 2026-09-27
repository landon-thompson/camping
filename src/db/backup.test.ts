import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './local';
import { makeBackup, parseBackup, restoreBackup } from './backup';
import type { LocalRecord } from '../sync/merge';

const rec = (id: string, updatedAt: number, data: unknown = { v: updatedAt }): LocalRecord => ({
  id,
  type: 'gear',
  data,
  updatedAt,
  updatedBy: null,
  deleted: 0,
  dirty: 0,
});

describe('backup & restore', () => {
  beforeEach(async () => {
    await db.records.clear();
  });

  it('round-trips and never overwrites newer edits', async () => {
    await db.records.bulkPut([rec('a', 100), rec('b', 100)]);
    const file = parseBackup(JSON.stringify(await makeBackup(new Date('2027-06-01T00:00:00Z'))));
    expect(file.records).toHaveLength(2);

    await db.records.put(rec('a', 200, 'newer on phone'));
    await db.records.delete('b');
    const result = await restoreBackup(file);
    expect(result).toEqual({ added: 1, updated: 0, skipped: 1 });
    expect((await db.records.get('a'))?.data).toBe('newer on phone');
    expect((await db.records.get('b'))?.dirty).toBe(1);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(/isn’t a Camp Planner backup/);
    expect(() => parseBackup('not json')).toThrow();
    expect(() => parseBackup(JSON.stringify({ app: 'camp-planner', version: 1, records: [{ id: 1 }] }))).toThrow(/damaged/);
  });
});
