import { beforeAll, describe, expect, it } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';

process.env.DATA_STORE = 'memory';

import { getStore, householdId } from '../lib/storeFactory';
import { shareCreate, shareGet, shareRevoke } from './share';

const header = (p: object) => Buffer.from(JSON.stringify(p)).toString('base64');
const familyHeader = header({ userId: 'u1', userDetails: 'a@b.c', userRoles: ['authenticated', 'family'] });

function fakeRequest(opts: { authHeader?: string | null; body?: unknown; params?: Record<string, string> } = {}): HttpRequest {
  return {
    headers: { get: (name: string) => (name.toLowerCase() === 'x-ms-client-principal' ? (opts.authHeader ?? null) : null) },
    json: async () => {
      if (opts.body === undefined) throw new Error('no body');
      return opts.body;
    },
    params: opts.params ?? {},
  } as unknown as HttpRequest;
}

const ctx = { error: () => undefined } as unknown as InvocationContext;

describe('share function handlers (MemoryStore)', () => {
  beforeAll(async () => {
    await getStore().push(householdId(), 'u1', [
      { id: 'trip:share-1', type: 'trip', data: { name: 'Shakedown', campgroundId: 'campground:1' }, updatedAt: 1, deleted: false },
      { id: 'campground:1', type: 'campground', data: { name: 'Test park', bookingSystem: 'reservemn' }, updatedAt: 1, deleted: false },
      {
        id: 'reservation:1',
        type: 'reservation',
        data: { tripId: 'trip:share-1', status: 'booked', arrivalDate: '2027-06-01', nights: 2, site: 'A1', confirmation: 'SECRET', costUsd: 40 },
        updatedAt: 1,
        deleted: false,
      },
    ]);
  });

  it('rejects share creation without a family role', async () => {
    expect((await shareCreate(fakeRequest({ authHeader: null, body: { tripId: 'trip:share-1' } }), ctx)).status).toBe(401);
    const outsider = header({ userId: 'u2', userRoles: ['authenticated'] });
    expect((await shareCreate(fakeRequest({ authHeader: outsider, body: { tripId: 'trip:share-1' } }), ctx)).status).toBe(403);
  });

  it('rejects a missing or malformed tripId', async () => {
    expect((await shareCreate(fakeRequest({ authHeader: familyHeader, body: {} }), ctx)).status).toBe(400);
    expect((await shareCreate(fakeRequest({ authHeader: familyHeader, body: { tripId: 'not-a-trip-id' } }), ctx)).status).toBe(400);
  });

  it('404s creating a link for a trip that does not exist', async () => {
    const res = await shareCreate(fakeRequest({ authHeader: familyHeader, body: { tripId: 'trip:does-not-exist' } }), ctx);
    expect(res.status).toBe(404);
  });

  it('creates a link, serves the public payload with the reservation redacted, then revokes it', async () => {
    const created = await shareCreate(fakeRequest({ authHeader: familyHeader, body: { tripId: 'trip:share-1' } }), ctx);
    expect(created.status).toBe(200);
    const { token } = created.jsonBody as { token: string };
    expect(typeof token).toBe('string');

    const unknown = await shareGet(fakeRequest({ params: { token: 'not-a-real-token' } }), ctx);
    expect(unknown.status).toBe(404);

    const got = await shareGet(fakeRequest({ params: { token } }), ctx);
    expect(got.status).toBe(200);
    const body = got.jsonBody as {
      trip: { name: string };
      campground: { name: string } | null;
      reservation: Record<string, unknown> | null;
      routes: unknown[];
      pins: unknown[];
    };
    expect(body.trip.name).toBe('Shakedown');
    expect(body.campground?.name).toBe('Test park');
    expect(body.reservation).toEqual({ status: 'booked', arrivalDate: '2027-06-01', nights: 2, site: 'A1' });
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toMatch(/costUsd/);
    expect(body.routes).toEqual([]);
    expect(body.pins).toEqual([]);

    expect((await shareRevoke(fakeRequest({ authHeader: null, params: { token } }), ctx)).status).toBe(401);
    expect((await shareRevoke(fakeRequest({ authHeader: familyHeader, params: { token: 'bogus' } }), ctx)).status).toBe(404);
    expect((await shareRevoke(fakeRequest({ authHeader: familyHeader, params: { token } }), ctx)).status).toBe(200);

    const afterRevoke = await shareGet(fakeRequest({ params: { token } }), ctx);
    expect(afterRevoke.status).toBe(404);
  });
});
