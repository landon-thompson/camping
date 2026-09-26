import Dexie, { type EntityTable } from 'dexie';
import type { LocalRecord } from '../sync/merge';

interface MetaRow {
  key: string;
  value: unknown;
}

/** On-phone database. This is the app's primary store; the server is a sync copy. */
export class CampDB extends Dexie {
  records!: EntityTable<LocalRecord, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'camp-planner') {
    super(name);
    this.version(1).stores({
      records: 'id, type, dirty, [type+deleted]',
      meta: 'key',
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
