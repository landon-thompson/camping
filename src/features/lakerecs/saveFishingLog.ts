import { newId, saveRecord } from '../../db/records';
import type { FishingLog } from '../../model/lakerecs';

/** Save one outing as its own `fishing_log` record (syncs; never committed). Returns the record id. Throws if the log fails validation. */
export async function saveFishingLog(log: FishingLog): Promise<string> {
  const id = newId('fishing_log');
  await saveRecord('fishing_log', id, log);
  return id;
}
