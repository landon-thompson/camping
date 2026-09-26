/** A synced record as the server stores it. `data` is opaque JSON to the server. */
export interface StoredRecord {
  id: string;
  type: string;
  data: unknown;
  updatedAt: number;
  updatedBy: string | null;
  deleted: boolean;
  /** Monotonic change number; clients pull everything newer than their cursor. */
  rev: string;
}

export interface IncomingRecord {
  id: string;
  type: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
}

export interface PushResult {
  accepted: { id: string; rev: string }[];
  /** Server already had a newer version; here it is so the client can adopt it. */
  rejected: StoredRecord[];
}

export interface PullResult {
  records: StoredRecord[];
  cursor: string;
  more: boolean;
}

export interface Member {
  userId: string;
  email: string;
  identityProvider: string;
}

/** A read-only share link (Phase 2), as the server stores it. */
export interface ShareLinkRow {
  tripId: string;
  revoked: boolean;
}

export interface Store {
  ensureMember(householdId: string, member: Member): Promise<void>;
  push(householdId: string, userId: string, records: IncomingRecord[]): Promise<PushResult>;
  pull(householdId: string, since: string, limit: number): Promise<PullResult>;

  /** A single non-deleted record by type and id, or null. */
  getRecord(householdId: string, type: string, id: string): Promise<StoredRecord | null>;
  /** Non-deleted records of a type whose `data.tripId` matches (reservation, route, pin). */
  getRecordsByTripId(householdId: string, type: string, tripId: string): Promise<StoredRecord[]>;

  /** Create a new share link. `token` must already be unique (the caller generates it). */
  createShareLink(householdId: string, token: string, tripId: string, createdBy: string | null): Promise<void>;
  /** Look up a share link by its token. Null if the token is unknown for this household. */
  getShareLink(householdId: string, token: string): Promise<ShareLinkRow | null>;
  /** Revoke a share link. Returns false if the token is unknown for this household (idempotent otherwise). */
  revokeShareLink(householdId: string, token: string): Promise<boolean>;
}

/**
 * Conflict rule shared with the app: last write wins by the editing phone's
 * timestamp, ties go to the incoming write.
 */
export function incomingWins(incomingUpdatedAt: number, storedUpdatedAt: number): boolean {
  return incomingUpdatedAt >= storedUpdatedAt;
}

/** In-memory store for local development and tests. Data vanishes on restart. */
export class MemoryStore implements Store {
  private rows = new Map<string, StoredRecord & { householdId: string }>();
  private rev = 0;
  members = new Map<string, Member & { householdId: string }>();
  private shareLinks = new Map<string, ShareLinkRow & { householdId: string }>();

  async ensureMember(householdId: string, member: Member): Promise<void> {
    this.members.set(member.userId, { ...member, householdId });
  }

  async push(householdId: string, userId: string, records: IncomingRecord[]): Promise<PushResult> {
    const result: PushResult = { accepted: [], rejected: [] };
    for (const r of records) {
      const key = `${householdId}\u0000${r.id}`;
      const existing = this.rows.get(key);
      if (existing && !incomingWins(r.updatedAt, existing.updatedAt)) {
        const { householdId: _h, ...stored } = existing;
        result.rejected.push(stored);
        continue;
      }
      const rev = String(++this.rev);
      this.rows.set(key, { ...r, updatedBy: userId, rev, householdId });
      result.accepted.push({ id: r.id, rev });
    }
    return result;
  }

  async pull(householdId: string, since: string, limit: number): Promise<PullResult> {
    const after = BigInt(since);
    const all = [...this.rows.values()]
      .filter((r) => r.householdId === householdId && BigInt(r.rev) > after)
      .sort((a, b) => (BigInt(a.rev) < BigInt(b.rev) ? -1 : 1));
    const page = all.slice(0, limit).map(({ householdId: _h, ...r }) => r);
    const last = page[page.length - 1];
    return { records: page, cursor: last ? last.rev : since, more: all.length > limit };
  }

  async getRecord(householdId: string, type: string, id: string): Promise<StoredRecord | null> {
    const row = this.rows.get(`${householdId}\u0000${id}`);
    if (!row || row.deleted || row.type !== type) return null;
    const { householdId: _h, ...stored } = row;
    return stored;
  }

  async getRecordsByTripId(householdId: string, type: string, tripId: string): Promise<StoredRecord[]> {
    const out: StoredRecord[] = [];
    for (const row of this.rows.values()) {
      if (row.householdId !== householdId || row.type !== type || row.deleted) continue;
      const data = row.data as { tripId?: unknown } | null;
      if (data && typeof data === 'object' && data.tripId === tripId) {
        const { householdId: _h, ...stored } = row;
        out.push(stored);
      }
    }
    return out;
  }

  async createShareLink(householdId: string, token: string, tripId: string, _createdBy: string | null): Promise<void> {
    this.shareLinks.set(token, { householdId, tripId, revoked: false });
  }

  async getShareLink(householdId: string, token: string): Promise<ShareLinkRow | null> {
    const row = this.shareLinks.get(token);
    if (!row || row.householdId !== householdId) return null;
    return { tripId: row.tripId, revoked: row.revoked };
  }

  async revokeShareLink(householdId: string, token: string): Promise<boolean> {
    const row = this.shareLinks.get(token);
    if (!row || row.householdId !== householdId) return false;
    row.revoked = true;
    return true;
  }
}
