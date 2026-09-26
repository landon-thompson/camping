import Dexie, { type EntityTable } from 'dexie';
import type { LocalRecord } from '../sync/merge';

/** Binary data kept on this phone only (never synced as records). */
export interface BlobRow {
  id: string;
  blob: Blob;
  contentType: string;
  createdAt: number;
}

interface MetaRow {
  key: string;
  value: unknown;
}

/** On-phone database. This is the app's primary store; the server is a sync copy. */
export class CampDB extends Dexie {
  records!: EntityTable<LocalRecord, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  blobs!: EntityTable<BlobRow, 'id'>;

  constructor(name = 'camp-planner') {
    super(name);
    this.version(1).stores({
      records: 'id, type, dirty, [type+deleted]',
      meta: 'key',
    });
    this.version(2).stores({
      blobs: 'id, createdAt',
    });
  }
}

export const db = new CampDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
