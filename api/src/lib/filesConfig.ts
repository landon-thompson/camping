/**
 * Configuration and path rules for trip photos in Azure Blob Storage.
 * Deliberately dependency-free (no Azure SDK import) so every rule here can be
 * unit tested offline — see filesConfig.test.ts.
 */

export const DEFAULT_CONTAINER = 'photos';

/** Photo record ids look like `photo:<uuid-or-fallback>` (see src/db/records.ts newId()). */
const PHOTO_ID_RE = /^photo:[A-Za-z0-9_-]{1,120}$/;

/** The pipeline always uploads a resized JPEG (see PhotoAttach); keep this tight. */
export const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg']);

export function containerName(): string {
  return process.env.PHOTO_CONTAINER?.trim() || DEFAULT_CONTAINER;
}

export class StorageNotConfiguredError extends Error {}

/** Throws a friendly, actionable message if Blob Storage hasn't been set up yet. */
export function requireConnectionString(): string {
  const cs = process.env.STORAGE_CONNECTION_STRING;
  if (!cs) {
    throw new StorageNotConfiguredError(
      'Photo storage not configured: add STORAGE_CONNECTION_STRING in the Static Web App → Environment variables (see docs/phase-5.md).',
    );
  }
  return cs;
}

/**
 * The only shape a photo blob path may take: `<household>/photos/<id>.jpg`.
 * Returns null for a malformed photo id so callers can reject the request.
 */
export function blobPathFor(householdId: string, photoId: string): string | null {
  if (!PHOTO_ID_RE.test(photoId)) return null;
  const idPart = photoId.slice('photo:'.length);
  return `${householdId}/photos/${idPart}.jpg`;
}

/**
 * Guards a client-supplied read path: it must stay inside this household's own
 * photo prefix, with no traversal, so one family can never read another's blob
 * (or an unrelated blob in the same container).
 */
export function isPathInHousehold(path: unknown, householdId: string): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 300) return false;
  if (path.includes('..') || path.includes('\\')) return false;
  const prefix = `${householdId}/photos/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,120}\.jpg$/.test(rest);
}

export function isAllowedContentType(contentType: unknown): contentType is string {
  return typeof contentType === 'string' && ALLOWED_CONTENT_TYPES.has(contentType);
}
