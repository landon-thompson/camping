import { describe, expect, it } from 'vitest';
import { D1Store } from './d1Store';
import { memoryD1 } from './testing/d1Shim';

const rec = (id: string, updatedAt: number, data: unknown = { name: id }, type = 'trip') => ({ id, type, data, updatedAt, deleted: false });

describe('D1 sync store', () => {
  it('accepts new and newer edits, rejects older ones with what the server has', async () => {
    const s = new D1Store(memoryD1());
    const first = await s.push('family', 'a@x.com', [rec('trip:1', 100), rec('trip:2', 100, 'just text')]);
    expect(first.accepted).toEqual([{ id: 'trip:1', rev: '1' }, { id: 'trip:2', rev: '2' }]);
    expect(first.rejected).toEqual([]);

    const second = await s.push('family', 'b@x.com', [rec('trip:1', 50, { name: 'old' }), rec('trip:2', 100, { name: 'tie wins' }), rec('trip:3', 1)]);
    expect(second.accepted.map((a) => a.id)).toEqual(['trip:2', 'trip:3']);
    expect(second.rejected).toEqual([{ id: 'trip:1', type: 'trip', data: { name: 'trip:1' }, updatedAt: 100, updatedBy: 'a@x.com', deleted: false, rev: '1' }]);

    const pulled = await s.pull('family', '0', 10);
    expect(pulled.records.map((r) => [r.id, r.rev, r.data])).toEqual([
      ['trip:1', '1', { name: 'trip:1' }],
      ['trip:2', '4', { name: 'tie wins' }],
      ['trip:3', '5', { name: 'trip:3' }],
    ]);
    expect(pulled).toMatchObject({ cursor: '5', more: false });
    const page = await s.pull('family', '1', 1);
    expect(page).toMatchObject({ cursor: '4', more: true });
    expect((await s.pull('family', '5', 10)).records).toEqual([]);
  });

  it('keeps each person’s space separate and finds trip items', async () => {
    const s = new D1Store(memoryD1());
    await s.push('family', 'a@x.com', [rec('trip:1', 1), rec('reservation:1', 1, { tripId: 'trip:1', confirmation: 'X' }, 'reservation')]);
    await s.push('person:z@x.com', 'z@x.com', [rec('trip:1', 1, { name: 'theirs' })]);
    expect((await s.getRecord('family', 'trip', 'trip:1'))?.data).toEqual({ name: 'trip:1' });
    expect((await s.getRecord('person:z@x.com', 'trip', 'trip:1'))?.data).toEqual({ name: 'theirs' });
    expect(await s.getRecord('family', 'campground', 'trip:1')).toBeNull();
    expect((await s.getRecordsByTripId('family', 'reservation', 'trip:1')).map((r) => r.id)).toEqual(['reservation:1']);
    expect(await s.getRecordsByTripId('person:z@x.com', 'reservation', 'trip:1')).toEqual([]);
    await s.push('family', 'a@x.com', [{ ...rec('trip:1', 2), deleted: true }]);
    expect(await s.getRecord('family', 'trip', 'trip:1')).toBeNull();
    expect((await s.pull('family', '0', 10)).records.find((r) => r.id === 'trip:1')?.deleted).toBe(true);
  });

  it('splits big uploads into pieces and stays within the free plan’s query limit', async () => {
    const db = memoryD1();
    const s = new D1Store(db);
    await s.pull('family', '0', 1); // create tables first
    db.queries = 0;
    const big = 'x'.repeat(200_000);
    const records = Array.from({ length: 100 }, (_, i) => rec(`photo:${i}`, 1, { big }));
    const res = await s.push('family', 'a@x.com', records);
    // 7 records fit a 1.5 MB piece; 8 pieces are written, the rest wait for the next sync.
    expect(res.accepted.length).toBe(56);
    expect(res.accepted.map((a) => a.id)).toEqual(records.slice(0, 56).map((r) => r.id));
    expect(db.queries).toBeLessThanOrEqual(40);
    const pulled = await s.pull('family', '0', 500);
    expect(pulled.more).toBe(true); // capped by size
    expect(pulled.records.length).toBeLessThan(56);
  });

  it('share links and the people list', async () => {
    const s = new D1Store(memoryD1());
    await s.createShareLink('family', 'tok_abcdefghijklmnop', 'trip:1', 'a@x.com');
    expect(await s.findShareLink('tok_abcdefghijklmnop')).toEqual({ household: 'family', tripId: 'trip:1', revoked: false });
    expect(await s.getShareLink('person:z@x.com', 'tok_abcdefghijklmnop')).toBeNull();
    expect(await s.revokeShareLink('person:z@x.com', 'tok_abcdefghijklmnop')).toBe(false);
    expect(await s.revokeShareLink('family', 'tok_abcdefghijklmnop')).toBe(true);
    expect((await s.getShareLink('family', 'tok_abcdefghijklmnop'))?.revoked).toBe(true);

    await s.notePerson('Z@x.com', 'person:z@x.com', 1_000_000);
    await s.notePerson('z@x.com', 'person:z@x.com', 1_000_100); // too soon: not counted
    await s.notePerson('a@x.com', 'family', 1_500_000);
    await s.notePerson('z@x.com', 'person:z@x.com', 2_000_000);
    expect(await s.listPeople()).toEqual([
      { email: 'z@x.com', household: 'person:z@x.com', firstSeen: 1_000_000, lastSeen: 2_000_000, visits: 2 },
      { email: 'a@x.com', household: 'family', firstSeen: 1_500_000, lastSeen: 1_500_000, visits: 1 },
    ]);
  });
});
