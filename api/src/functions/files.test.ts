import type { HttpRequest, InvocationContext } from '@azure/functions';
import { afterEach, describe, expect, it } from 'vitest';
import { filesReadUrl, filesUploadUrl } from './files';

const FAKE_CONN_STR = `DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=${Buffer.from('fake-key-not-real').toString('base64')};EndpointSuffix=core.windows.net`;

const principalHeader = (roles: string[]) =>
  Buffer.from(JSON.stringify({ userId: 'u1', userDetails: 'a@b.c', userRoles: roles })).toString('base64');

const ctx = { error: () => undefined } as unknown as InvocationContext;

function fakeRequest(opts: { principal?: string | null; body?: unknown; query?: Record<string, string> }): HttpRequest {
  return {
    headers: { get: (name: string) => (name === 'x-ms-client-principal' ? (opts.principal ?? null) : null) },
    json: async () => opts.body,
    query: { get: (name: string) => opts.query?.[name] ?? null },
  } as unknown as HttpRequest;
}

afterEach(() => {
  delete process.env.STORAGE_CONNECTION_STRING;
  delete process.env.HOUSEHOLD_ID;
});

describe('POST /api/files/upload-url', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await filesUploadUrl(fakeRequest({ principal: null }), ctx);
    expect(res.status).toBe(401);
  });

  it('rejects a signed-in caller without the family role', async () => {
    const req = fakeRequest({ principal: principalHeader(['authenticated']), body: { photoId: 'photo:a', contentType: 'image/jpeg' } });
    const res = await filesUploadUrl(req, ctx);
    expect(res.status).toBe(403);
  });

  it('rejects a bad photoId or contentType', async () => {
    const principal = principalHeader(['family']);
    const badId = await filesUploadUrl(fakeRequest({ principal, body: { photoId: 'gear:a', contentType: 'image/jpeg' } }), ctx);
    expect(badId.status).toBe(400);
    const badType = await filesUploadUrl(fakeRequest({ principal, body: { photoId: 'photo:a', contentType: 'text/html' } }), ctx);
    expect(badType.status).toBe(400);
  });

  it('returns 503 with a helpful message when storage is not configured', async () => {
    const principal = principalHeader(['family']);
    const res = await filesUploadUrl(fakeRequest({ principal, body: { photoId: 'photo:a', contentType: 'image/jpeg' } }), ctx);
    expect(res.status).toBe(503);
    expect((res.jsonBody as { error: string }).error).toMatch(/STORAGE_CONNECTION_STRING/);
  });

  it('returns a household-scoped upload URL and blob path when configured', async () => {
    process.env.STORAGE_CONNECTION_STRING = FAKE_CONN_STR;
    process.env.HOUSEHOLD_ID = 'family';
    const principal = principalHeader(['family']);
    const res = await filesUploadUrl(fakeRequest({ principal, body: { photoId: 'photo:abc-123', contentType: 'image/jpeg' } }), ctx);
    expect(res.status).toBe(200);
    const body = res.jsonBody as { uploadUrl: string; blobPath: string };
    expect(body.blobPath).toBe('family/photos/abc-123.jpg');
    expect(body.uploadUrl).toContain('family/photos/abc-123.jpg');
    const qs = new URLSearchParams(body.uploadUrl.split('?')[1]);
    expect(qs.get('sp')).toBe('cw');
  });
});

describe('GET /api/files/read-url', () => {
  it('rejects a path outside this household', async () => {
    process.env.STORAGE_CONNECTION_STRING = FAKE_CONN_STR;
    const principal = principalHeader(['family']);
    const res = await filesReadUrl(fakeRequest({ principal, query: { path: 'other-household/photos/x.jpg' } }), ctx);
    expect(res.status).toBe(400);
  });

  it('returns a read-only SAS URL for a valid path', async () => {
    process.env.STORAGE_CONNECTION_STRING = FAKE_CONN_STR;
    const principal = principalHeader(['family']);
    const res = await filesReadUrl(fakeRequest({ principal, query: { path: 'family/photos/abc-123.jpg' } }), ctx);
    expect(res.status).toBe(200);
    const body = res.jsonBody as { readUrl: string };
    const qs = new URLSearchParams(body.readUrl.split('?')[1]);
    expect(qs.get('sp')).toBe('r');
  });
});
