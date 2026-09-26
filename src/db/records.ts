import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './local';
import { recordSchemas, type RecordData, type RecordType } from '../model/schemas';
import { SEED_RECORDS } from '../seed/seed';
import { getCachedUser } from '../auth/identity';
import { notifyLocalChange } from '../sync/signal';

/** Save a record on this phone. It syncs to the server in the background. */
export async function saveRecord<T extends RecordType>(type: T, id: string, data: RecordData<T>): Promise<void> {
  const parsed = recordSchemas[type].parse(data);
  await db.records.put({
    id,
    type,
    data: parsed,
    updatedAt: Date.now(),
    updatedBy: getCachedUser()?.userId ?? null,
    deleted: 0,
    dirty: 1,
  });
  notifyLocalChange();
}

/** Soft-delete, so the deletion syncs to the other phone. */
export async function deleteRecord(id: string): Promise<void> {
  await db.records.update(id, {
    deleted: 1,
    dirty: 1,
    updatedAt: Date.now(),
    updatedBy: getCachedUser()?.userId ?? null,
  });
  notifyLocalChange();
}

export interface Loaded<T> {
  loading: boolean;
  data: T | undefined;
  error?: string;
}

/** Live-updating single record, validated against its schema. */
export function useRecord<T extends RecordType>(type: T, id: string): Loaded<RecordData<T>> {
  const row = useLiveQuery(() => db.records.get(id), [id], null);
  if (row === null) return { loading: true, data: undefined };
  if (!row || row.deleted || row.type !== type) return { loading: false, data: undefined };
  const parsed = recordSchemas[type].safeParse(row.data);
  if (!parsed.success) return { loading: false, data: undefined, error: parsed.error.message };
  return { loading: false, data: parsed.data as RecordData<T> };
}

/**
 * Insert any seed record this phone has never seen (including deleted ones).
 * Seeds carry timestamp 0 so they never overwrite a real edit during sync.
 */
export async function ensureSeeds(): Promise<number> {
  let added = 0;
  await db.transaction('rw', db.records, async () => {
    for (const seed of SEED_RECORDS) {
      if (await db.records.get(seed.id)) continue;
      await db.records.add({
        id: seed.id,
        type: seed.type,
        data: recordSchemas[seed.type].parse(seed.data),
        updatedAt: 0,
        updatedBy: null,
        deleted: 0,
        dirty: 1,
      });
      added++;
    }
  });
  if (added > 0) notifyLocalChange();
  return added;
}
