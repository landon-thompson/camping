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

export interface Store {
  ensureMember(householdId: string, member: Member): Promise<void>;
  push(householdId: string, userId: string, records: IncomingRecord[]): Promise<PushResult>;
  pull(householdId: string, since: string, limit: number): Promise<PullResult>;
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
}
