import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { ridbFacilities } from './ridb';

const FAMILY_HEADER = Buffer.from(
  JSON.stringify({ userId: 'u1', userDetails: 'a@b.c', identityProvider: 'aad', userRoles: ['authenticated', 'family'] }),
).toString('base64');

function fakeRequest(params: Record<string, string> = {}, principalHeader: string | null = FAMILY_HEADER): HttpRequest {
  const query = new URLSearchParams(params);
  return {
    headers: { get: (name: string) => (name.toLowerCase() === 'x-ms-client-principal' ? principalHeader : null) },
    query: { get: (name: string) => query.get(name) },
  } as unknown as HttpRequest;
}

const ctx = { warn: vi.fn(), error: vi.fn() } as unknown as InvocationContext;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/ridb/facilities', () => {
  it('requires a signed-in family member', async () => {
    const res = await ridbFacilities(fakeRequest({}, null), ctx);
    expect(res.status).toBe(401);
  });

  it('rejects an invalid query/state/limit before touching RIDB', async () => {
    vi.stubEnv('RIDB_API_KEY', 'k');
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const res = await ridbFacilities(fakeRequest({ limit: '0' }), ctx);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a clear 503 when RIDB_API_KEY is missing, without calling fetch', async () => {
    vi.stubEnv('RIDB_API_KEY', '');
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const res = await ridbFacilities(fakeRequest({ query: 'Norway' }), ctx);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.jsonBody)).toMatch(/RIDB_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns trimmed results on success', async () => {
    vi.stubEnv('RIDB_API_KEY', 'secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          RECDATA: [{ FacilityID: '1', FacilityName: 'Test Campground', FacilityLatitude: 47, FacilityLongitude: -92 }],
        }),
      })),
    );
    const res = await ridbFacilities(fakeRequest({ query: 'Test', state: 'mn' }), ctx);
    expect(res.status).toBe(200);
    expect(res.jsonBody).toEqual({
      results: [
        {
          id: '1',
          name: 'Test Campground',
          lat: 47,
          lng: -92,
          description: '',
          reservationUrl: 'https://www.recreation.gov/camping/campgrounds/1',
        },
      ],
    });
  });

  it('maps an upstream failure to a 502', async () => {
    vi.stubEnv('RIDB_API_KEY', 'secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    const res = await ridbFacilities(fakeRequest({}), ctx);
    expect(res.status).toBe(502);
  });
});
