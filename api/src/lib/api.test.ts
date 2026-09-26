import { describe, expect, it } from 'vitest';
import { authorize, parsePrincipal } from './principal';
import { MemoryStore, type IncomingRecord } from './store';
import { MAX_CLOCK_SKEW_MS, parsePullQuery, parsePushBody } from './validate';

const header = (p: object) => Buffer.from(JSON.stringify(p)).toString('base64');
const rec = (id: string, updatedAt: number, data: unknown = { v: updatedAt }, deleted = false): IncomingRecord => ({
  id,
  type: 'gear',
  data,
  updatedAt,
  deleted,
});

describe('principal', () => {
  it('rejects missing or malformed headers', () => {
    expect(parsePrincipal(undefined)).toBeNull();
    expect(parsePrincipal('not base64 json')).toBeNull();
    expect(parsePrincipal(header({ userDetails: 'x' }))).toBeNull();
  });

  it('requires the family role', () => {
    const outsider = authorize(header({ userId: 'u1', userRoles: ['anonymous', 'authenticated'] }));
    expect(outsider).toMatchObject({ ok: false, status: 403 });
    const member = authorize(header({ userId: 'u1', userDetails: 'a@b.c', userRoles: ['authenticated', 'family'] }));
    expect(member).toMatchObject({ ok: true, principal: { userId: 'u1' } });
    expect(authorize(null)).toMatchObject({ ok: false, status: 401 });
  });
});

describe('validation', () => {
  const now = 1_800_000_000_000;

  it('accepts a well-formed push', () => {
    const r = parsePushBody({ records: [rec('gear:1', now)] }, now);
    expect(r.ok).toBe(true);
  });

  it('rejects bad ids, types, duplicates and future timestamps', () => {
    expect(parsePushBody({ records: [{ ...rec('bad id!', now) }] }, now).ok).toBe(false);
    expect(parsePushBody({ records: [{ ...rec('a', now), type: 'Bad Type' }] }, now).ok).toBe(false);
    expect(parsePushBody({ records: [rec('a', now), rec('a', now)] }, now).ok).toBe(false);
    expect(parsePushBody({ records: [rec('a', now + MAX_CLOCK_SKEW_MS + 1)] }, now).ok).toBe(false);
    expect(parsePushBody({ records: [{ ...rec('a', now), deleted: 'no' }] }, now).ok).toBe(false);
    expect(parsePushBody({ nope: true }, now).ok).toBe(false);
  });

  it('validates pull cursors within SQL bigint range', () => {
    expect(parsePullQuery(null, null)).toEqual({ ok: true, value: { since: '0', limit: 500 } });
    expect(parsePullQuery('9223372036854775807', '10').ok).toBe(true);
    expect(parsePullQuery('9223372036854775808', '10').ok).toBe(false);
    expect(parsePullQuery('-1', null).ok).toBe(false);
    expect(parsePullQuery('5', '0').ok).toBe(false);
  });
});

describe('MemoryStore (reference behaviour for SqlStore)', () => {
  it('applies last-write-wins and returns the winner on rejection', async () => {
    const s = new MemoryStore();
    const first = await s.push('h', 'u1', [rec('a', 200, 'new')]);
    expect(first.accepted).toHaveLength(1);
    const stale = await s.push('h', 'u2', [rec('a', 100, 'old')]);
    expect(stale.accepted).toHaveLength(0);
    expect(stale.rejected[0]).toMatchObject({ id: 'a', data: 'new', updatedAt: 200, updatedBy: 'u1' });
    const tie = await s.push('h', 'u2', [rec('a', 200, 'tie')]);
    expect(tie.accepted).toHaveLength(1);
  });

  it('pages changes in order and isolates households', async () => {
    const s = new MemoryStore();
    await s.push('h', 'u', [rec('a', 1), rec('b', 1), rec('c', 1)]);
    await s.push('other', 'u', [rec('x', 1)]);
    const p1 = await s.pull('h', '0', 2);
    expect(p1.records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(p1.more).toBe(true);
    const p2 = await s.pull('h', p1.cursor, 2);
    expect(p2.records.map((r) => r.id)).toEqual(['c']);
    expect(p2.more).toBe(false);
    const p3 = await s.pull('h', p2.cursor, 2);
    expect(p3.records).toEqual([]);
    expect(p3.cursor).toBe(p2.cursor);
  });
});
