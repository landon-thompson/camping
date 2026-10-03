import type { IncomingRecord, Member, PullResult, PushResult, ShareLinkRow, Store, StoredRecord } from '../api/src/lib/store';
import type { D1Database } from './d1';

/** D1's limit on one value is about 2 MB; stay well under it per upload chunk. */
const MAX_CHUNK_JSON = 1_500_000;
/** Free plan: 50 queries per request. Each chunk costs 4; leave room for the rest. */
const MAX_CHUNKS = 8;
/** Keep one pull response a comfortable size for a phone and a Worker. */
const MAX_PULL_BYTES = 6_000_000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
    household TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT, deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL,
    PRIMARY KEY (household, id))`,
  `CREATE INDEX IF NOT EXISTS records_by_rev ON records (household, rev)`,
  `CREATE INDEX IF NOT EXISTS records_by_type ON records (household, type)`,
  `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO counters (name, value) VALUES ('rev', 0)`,
  `CREATE TABLE IF NOT EXISTS share_links (
    token TEXT PRIMARY KEY, household TEXT NOT NULL, trip_id TEXT NOT NULL,
    created_by TEXT, created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS people (
    email TEXT PRIMARY KEY, household TEXT NOT NULL, first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 1)`,
];

export interface Person {
  email: string;
  household: string;
  firstSeen: number;
  lastSeen: number;
  visits: number;
}

interface Row {
  id: string;
  type: string;
  data: string;
  updated_at: number;
  updated_by: string | null;
  deleted: number;
  rev: number;
}

const toStored = (r: Row): StoredRecord => ({
  id: r.id,
  type: r.type,
  data: JSON.parse(r.data) as unknown,
  updatedAt: Number(r.updated_at),
  updatedBy: r.updated_by,
  deleted: !!r.deleted,
  rev: String(r.rev),
});

// Tables are created on first use, once per server instance.
const ready = new WeakMap<D1Database, Promise<void>>();

/** The sync store on Cloudflare D1 (SQLite). Same behaviour as the Azure SQL store. */
export class D1Store implements Store {
  constructor(private db: D1Database) {}

  private ensureSchema(): Promise<void> {
    let p = ready.get(this.db);
    if (!p) {
      p = this.db.batch(SCHEMA.map((s) => this.db.prepare(s))).then(() => undefined);
      p.catch(() => ready.delete(this.db));
      ready.set(this.db, p);
    }
    return p;
  }

  async ensureMember(householdId: string, member: Member): Promise<void> {
    await this.notePerson(member.email || member.userId, householdId);
  }

  /** Remember who signed in (first and last visit), at most one write per person every 10 minutes. */
  async notePerson(email: string, householdId: string, now = Date.now()): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT INTO people (email, household, first_seen, last_seen, visits) VALUES (?1, ?2, ?3, ?3, 1)
         ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen, household = excluded.household, visits = people.visits + 1
         WHERE people.last_seen < ?3 - 600000 OR people.household <> excluded.household`,
      )
      .bind(email.toLowerCase(), householdId, now)
      .run();
  }

  async listPeople(): Promise<Person[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare('SELECT email, household, first_seen, last_seen, visits FROM people ORDER BY last_seen DESC LIMIT 500')
      .all<{ email: string; household: string; first_seen: number; last_seen: number; visits: number }>();
    return results.map((r) => ({ email: r.email, household: r.household, firstSeen: Number(r.first_seen), lastSeen: Number(r.last_seen), visits: Number(r.visits) }));
  }

  async push(householdId: string, userId: string, records: IncomingRecord[]): Promise<PushResult> {
    await this.ensureSchema();
    const result: PushResult = { accepted: [], rejected: [] };
    // Split into chunks D1 can take in one value. Records past the last chunk
    // are left out of the answer; the phone keeps them and sends them next time.
    const chunks: { id: string; type: string; data: string; u: number; d: number }[][] = [];
    let cur: (typeof chunks)[number] = [];
    let size = 0;
    for (const r of records) {
      const row = { id: r.id, type: r.type, data: JSON.stringify(r.data), u: r.updatedAt, d: r.deleted ? 1 : 0 };
      const len = row.data.length + r.id.length + 80;
      if (cur.length && size + len > MAX_CHUNK_JSON) {
        chunks.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(row);
      size += len;
    }
    if (cur.length) chunks.push(cur);

    for (const chunk of chunks.slice(0, MAX_CHUNKS)) {
      const n = chunk.length;
      const payload = JSON.stringify(chunk);
      // One transaction: reserve n change numbers, write every row that wins
      // (newer or equal timestamp), then read back what's stored. A row whose
      // rev is the one we reserved for it was accepted; anything else lost.
      const [, , rows, top] = await this.db.batch([
        this.db.prepare(`UPDATE counters SET value = value + ?1 WHERE name = 'rev'`).bind(n),
        this.db
          .prepare(
            `INSERT INTO records (household, id, type, data, updated_at, updated_by, deleted, rev)
             SELECT ?1, json_extract(j.value, '$.id'), json_extract(j.value, '$.type'), json_extract(j.value, '$.data'),
                    json_extract(j.value, '$.u'), ?2, json_extract(j.value, '$.d'),
                    (SELECT value FROM counters WHERE name = 'rev') - ?3 + j.key + 1
             FROM json_each(?4) AS j WHERE true
             ON CONFLICT(household, id) DO UPDATE SET
               type = excluded.type, data = excluded.data, updated_at = excluded.updated_at,
               updated_by = excluded.updated_by, deleted = excluded.deleted, rev = excluded.rev
             WHERE excluded.updated_at >= records.updated_at`,
          )
          .bind(householdId, userId, n, payload),
        this.db
          .prepare(
            `SELECT id, type, data, updated_at, updated_by, deleted, rev FROM records
             WHERE household = ?1 AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
          )
          .bind(householdId, payload),
        this.db.prepare(`SELECT value FROM counters WHERE name = 'rev'`),
      ]);
      const topRev = Number((top!.results[0] as { value: number }).value);
      const byId = new Map((rows!.results as unknown as Row[]).map((r) => [r.id, r]));
      chunk.forEach((c, i) => {
        const row = byId.get(c.id);
        if (!row) return;
        const mine = topRev - n + i + 1;
        if (Number(row.rev) === mine) result.accepted.push({ id: c.id, rev: String(mine) });
        else result.rejected.push(toStored(row));
      });
    }
    return result;
  }

  async pull(householdId: string, since: string, limit: number): Promise<PullResult> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare('SELECT id, type, data, updated_at, updated_by, deleted, rev FROM records WHERE household = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3')
      .bind(householdId, Number(since), limit + 1)
      .all<Row>();
    const records: StoredRecord[] = [];
    let bytes = 0;
    let more = results.length > limit;
    for (const r of results.slice(0, limit)) {
      bytes += r.data.length;
      if (records.length && bytes > MAX_PULL_BYTES) {
        more = true;
        break;
      }
      records.push(toStored(r));
    }
    const last = records[records.length - 1];
    return { records, cursor: last ? last.rev : since, more };
  }

  async getRecord(householdId: string, type: string, id: string): Promise<StoredRecord | null> {
    await this.ensureSchema();
    const r = await this.db
      .prepare('SELECT id, type, data, updated_at, updated_by, deleted, rev FROM records WHERE household = ?1 AND id = ?2 AND type = ?3 AND deleted = 0')
      .bind(householdId, id, type)
      .first<Row>();
    return r ? toStored(r) : null;
  }

  async getRecordsByTripId(householdId: string, type: string, tripId: string): Promise<StoredRecord[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(
        `SELECT id, type, data, updated_at, updated_by, deleted, rev FROM records
         WHERE household = ?1 AND type = ?2 AND deleted = 0 AND json_extract(data, '$.tripId') = ?3`,
      )
      .bind(householdId, type, tripId)
      .all<Row>();
    return results.map(toStored);
  }

  async createShareLink(householdId: string, token: string, tripId: string, createdBy: string | null): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare('INSERT INTO share_links (token, household, trip_id, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(token, householdId, tripId, createdBy, Date.now())
      .run();
  }

  async getShareLink(householdId: string, token: string): Promise<ShareLinkRow | null> {
    const link = await this.findShareLink(token);
    return link && link.household === householdId ? { tripId: link.tripId, revoked: link.revoked } : null;
  }

  /** A share link by token alone (public links don't know whose trip it is). */
  async findShareLink(token: string): Promise<(ShareLinkRow & { household: string }) | null> {
    await this.ensureSchema();
    const r = await this.db
      .prepare('SELECT household, trip_id, revoked FROM share_links WHERE token = ?1')
      .bind(token)
      .first<{ household: string; trip_id: string; revoked: number }>();
    return r ? { household: r.household, tripId: r.trip_id, revoked: !!r.revoked } : null;
  }

  async revokeShareLink(householdId: string, token: string): Promise<boolean> {
    await this.ensureSchema();
    const link = await this.findShareLink(token);
    if (!link || link.household !== householdId) return false;
    await this.db.prepare('UPDATE share_links SET revoked = 1 WHERE token = ?1').bind(token).run();
    return true;
  }
}
