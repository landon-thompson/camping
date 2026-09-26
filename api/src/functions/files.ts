import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { authorize } from '../lib/principal';
import { householdId } from '../lib/storeFactory';
import {
  StorageNotConfiguredError,
  blobPathFor,
  isAllowedContentType,
  isPathInHousehold,
} from '../lib/filesConfig';
import { readUrlFor, uploadUrlFor } from '../lib/filesSas';

const json = (status: number, body: unknown): HttpResponseInit => ({
  status,
  jsonBody: body,
  headers: { 'cache-control': 'no-store' },
});

async function handle(
  req: HttpRequest,
  ctx: InvocationContext,
  fn: () => Promise<HttpResponseInit>,
): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) return json(503, { error: e.message });
    ctx.error('files failed', e);
    return json(500, { error: 'Server error' });
  }
}

/**
 * POST /api/files/upload-url { photoId, contentType }
 * Returns a short-lived, write-only SAS URL for this one photo blob, plus the
 * path to save on the record once the PUT succeeds.
 */
export const filesUploadUrl = (req: HttpRequest, ctx: InvocationContext) =>
  handle(req, ctx, async () => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Body must be JSON' });
    }
    const { photoId, contentType } = (body ?? {}) as { photoId?: unknown; contentType?: unknown };
    if (typeof photoId !== 'string') return json(400, { error: 'photoId is required' });
    if (!isAllowedContentType(contentType)) {
      return json(400, { error: 'contentType must be one of: image/jpeg' });
    }
    const blobPath = blobPathFor(householdId(), photoId);
    if (!blobPath) return json(400, { error: 'photoId is not a valid photo record id' });

    const { url } = uploadUrlFor(blobPath);
    return json(200, { uploadUrl: url, blobPath });
  });

/**
 * GET /api/files/read-url?path=<blobPath>
 * Returns a short-lived, read-only SAS URL for a blob already saved under this
 * household's own prefix (never another household's).
 */
export const filesReadUrl = (req: HttpRequest, ctx: InvocationContext) =>
  handle(req, ctx, async () => {
    const path = req.query.get('path');
    if (!isPathInHousehold(path, householdId())) {
      return json(400, { error: 'path is missing or not a valid photo path for this household' });
    }
    const { url } = readUrlFor(path);
    return json(200, { readUrl: url });
  });

// Access is enforced by Static Web Apps roles (staticwebapp.config.json) *and* authorize().
app.http('filesUploadUrl', { route: 'files/upload-url', methods: ['POST'], authLevel: 'anonymous', handler: filesUploadUrl });
app.http('filesReadUrl', { route: 'files/read-url', methods: ['GET'], authLevel: 'anonymous', handler: filesReadUrl });
