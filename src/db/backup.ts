import { db } from './local';
import type { LocalRecord } from '../sync/merge';

/** A backup file: every record on this phone (including deletions, so restores stay consistent). */
export interface BackupFile {
  app: 'camp-planner';
  version: 1;
  exportedAt: string;
  records: LocalRecord[];
}

export async function makeBackup(now = new Date()): Promise<BackupFile> {
  return { app: 'camp-planner', version: 1, exportedAt: now.toISOString(), records: await db.records.toArray() };
}

export function parseBackup(text: string): BackupFile {
  const data = JSON.parse(text) as Partial<BackupFile>;
  if (data.app !== 'camp-planner' || data.version !== 1 || !Array.isArray(data.records)) {
    throw new Error('This isn’t a Camp Planner backup file.');
  }
  for (const r of data.records) {
    if (!r || typeof r.id !== 'string' || typeof r.type !== 'string' || typeof r.updatedAt !== 'number') {
      throw new Error('The backup file is damaged.');
    }
  }
  return data as BackupFile;
}

/**
 * Merge a backup into this phone: a record is replaced only when the backup's
 * copy is newer, so restoring an old backup never undoes newer edits.
 * Restored records are marked for sync, so they reach the server once one exists.
 */
export async function restoreBackup(backup: BackupFile): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  await db.transaction('rw', db.records, async () => {
    for (const r of backup.records) {
      const local = await db.records.get(r.id);
      if (!local) added++;
      else if (r.updatedAt > local.updatedAt) updated++;
      else {
        skipped++;
        continue;
      }
      await db.records.put({ ...r, deleted: r.deleted ? 1 : 0, dirty: 1 });
    }
  });
  return { added, updated, skipped };
}
