/**
 * Pure sync rules, shared by the pull and push paths. Kept free of IndexedDB so
 * they can be unit-tested directly.
 *
 * Conflict rule: last write wins per record, by the editing phone's clock
 * (`updatedAt`). Ties go to the incoming write — the server applies the same
 * rule, so both sides always agree on the winner.
 */

export interface LocalRecord {
  id: string;
  type: string;
  data: unknown;
  /** ms since epoch on the phone that made the edit; 0 = untouched seed */
  updatedAt: number;
  updatedBy: string | null;
  deleted: 0 | 1;
  /** 1 = changed on this phone and not yet accepted by the server */
  dirty: 0 | 1;
}

export interface RemoteRecord {
  id: string;
  type: string;
  data: unknown;
  updatedAt: number;
  updatedBy: string | null;
  deleted: boolean;
  rev: string;
}

export function fromRemote(r: RemoteRecord): LocalRecord {
  return {
    id: r.id,
    type: r.type,
    data: r.data,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    deleted: r.deleted ? 1 : 0,
    dirty: 0,
  };
}

/**
 * Decide what to store locally when a server record arrives.
 * Returns the record to write, or null to keep the local copy untouched.
 */
export function mergeRemote(local: LocalRecord | undefined, remote: RemoteRecord): LocalRecord | null {
  if (!local) return fromRemote(remote);
  // A pending local edit that is at least as new stays; it will be pushed.
  if (local.dirty === 1 && local.updatedAt >= remote.updatedAt) return null;
  return fromRemote(remote);
}

/**
 * After a push, decide what to do with a record the server accepted.
 * If the user edited it again while the request was in flight, it stays dirty.
 */
export function afterAccepted(current: LocalRecord | undefined, pushedUpdatedAt: number): LocalRecord | null {
  if (!current || current.updatedAt !== pushedUpdatedAt) return null;
  return { ...current, dirty: 0 };
}

/**
 * After a push, the server may reject a record because it already holds a newer
 * version. Take the server's copy unless a newer local edit happened meanwhile.
 */
export function afterRejected(
  current: LocalRecord | undefined,
  pushedUpdatedAt: number,
  server: RemoteRecord,
): LocalRecord | null {
  if (current && current.updatedAt !== pushedUpdatedAt) return mergeRemote(current, server);
  return fromRemote(server);
}
