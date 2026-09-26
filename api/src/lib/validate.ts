import type { IncomingRecord } from './store';

export const MAX_PUSH_RECORDS = 200;
export const MAX_RECORD_BYTES = 256 * 1024;
/** Reject edits stamped far in the future (a phone with a wrong clock would win forever). */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const MAX_BIGINT = 9223372036854775807n;
const ID_RE = /^[A-Za-z0-9:_\-.]{1,128}$/;
const TYPE_RE = /^[a-z][a-z0-9_]{0,39}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsePushBody(body: unknown, now = Date.now()): Parsed<IncomingRecord[]> {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { records?: unknown }).records)) {
    return { ok: false, error: 'Expected { records: [...] }' };
  }
  const input = (body as { records: unknown[] }).records;
  if (input.length > MAX_PUSH_RECORDS) return { ok: false, error: `At most ${MAX_PUSH_RECORDS} records per request` };

  const out: IncomingRecord[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: `records[${i}] is not an object` };
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return { ok: false, error: `records[${i}].id is invalid` };
    if (seen.has(r.id)) return { ok: false, error: `records[${i}].id is duplicated` };
    seen.add(r.id);
    if (typeof r.type !== 'string' || !TYPE_RE.test(r.type)) return { ok: false, error: `records[${i}].type is invalid` };
    if (typeof r.updatedAt !== 'number' || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0) {
      return { ok: false, error: `records[${i}].updatedAt is invalid` };
    }
    if (r.updatedAt > now + MAX_CLOCK_SKEW_MS) {
      return { ok: false, error: `records[${i}].updatedAt is in the future — check the phone's date & time` };
    }
    if (typeof r.deleted !== 'boolean') return { ok: false, error: `records[${i}].deleted must be true/false` };
    if (r.data === undefined) return { ok: false, error: `records[${i}].data is missing` };
    if (Buffer.byteLength(JSON.stringify(r.data), 'utf8') > MAX_RECORD_BYTES) {
      return { ok: false, error: `records[${i}] is too large` };
    }
    out.push({ id: r.id, type: r.type, data: r.data, updatedAt: r.updatedAt, deleted: r.deleted });
  }
  return { ok: true, value: out };
}

export function parsePullQuery(since: string | null, limit: string | null): Parsed<{ since: string; limit: number }> {
  const s = since ?? '0';
  if (!/^\d{1,19}$/.test(s) || BigInt(s) > MAX_BIGINT) return { ok: false, error: 'since must be a non-negative integer' };
  const n = limit === null ? 500 : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, error: 'limit must be 1–1000' };
  return { ok: true, value: { since: s, limit: n } };
}
