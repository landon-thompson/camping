import { getCachedUser } from '../../auth/identity';
import { db } from '../../db/local';
import { saveRecord } from '../../db/records';
import type { Photo } from '../../model/schemas';

/** Retry backoff for one photo's upload: starts at 15s, doubles, caps at 5 min. */
export const RETRY_BASE_MS = 15_000;
export const RETRY_MAX_MS = 5 * 60_000;

/** Pure: next backoff delay after a failure, given the current one (or none yet). */
export function nextBackoffDelay(current: number | undefined): number {
  if (current === undefined) return RETRY_BASE_MS;
  return Math.min(current * 2, RETRY_MAX_MS);
}

/** A photo still needs uploading once it has a local blob but no blobPath yet. */
export function needsUpload(data: Pick<Photo, 'blobPath'>): boolean {
  return data.blobPath === null;
}

const nextAttemptAt = new Map<string, number>();
const currentDelay = new Map<string, number>();

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function uploadOne(id: string, data: Photo, blob: Blob): Promise<boolean> {
  try {
    const res = await fetch('/api/files/upload-url', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photoId: id, contentType: data.contentType }),
    });
    if (!res.ok) return false;
    const { uploadUrl, blobPath } = (await res.json()) as { uploadUrl: string; blobPath: string };
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'content-type': data.contentType },
      body: blob,
    });
    if (!put.ok) return false;
    // Keep the local blob — it's still the fastest source and works offline.
    await saveRecord('photo', id, { ...data, blobPath });
    return true;
  } catch {
    return false;
  }
}

/** One pass over every not-yet-uploaded photo that has a local blob to send. */
export async function runUploadQueueOnce(): Promise<void> {
  if (!isOnline() || !getCachedUser()) return;
  const rows = await db.records.where('[type+deleted]').equals(['photo', 0]).toArray();
  const now = Date.now();
  for (const row of rows) {
    const data = row.data as Photo;
    if (!needsUpload(data)) continue;
    const due = nextAttemptAt.get(row.id);
    if (due !== undefined && due > now) continue;
    const blobRow = await db.blobs.get(row.id);
    if (!blobRow) continue; // nothing to send yet (record synced in before its blob arrived)
    const ok = await uploadOne(row.id, data, blobRow.blob);
    if (ok) {
      nextAttemptAt.delete(row.id);
      currentDelay.delete(row.id);
    } else {
      const delay = nextBackoffDelay(currentDelay.get(row.id));
      currentDelay.set(row.id, delay);
      nextAttemptAt.set(row.id, now + delay);
    }
  }
}

let started = false;

/** Starts the background upload loop once per app session. Call from a component's
 * effect (not App.tsx — this feature owns its own upload path). */
export function startPhotoUploadQueue(): void {
  if (started) return;
  started = true;
  const tick = () => {
    void runUploadQueueOnce().finally(() => {
      setTimeout(tick, RETRY_BASE_MS);
    });
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void runUploadQueueOnce());
  }
  tick();
}
