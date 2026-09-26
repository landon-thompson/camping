import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { authorize } from '../lib/principal';
import { getStore, householdId, StoreNotConfiguredError } from '../lib/storeFactory';
import { StoreUnavailableError } from '../lib/sqlStore';
import { generateShareToken, isValidTripId, redactReservation } from '../lib/shareService';

/**
 * Read-only trip share links (Phase 2). Static Web Apps routes `/api/share/*`
 * as anonymous (public GET needs no sign-in), so writes are gated here.
 */

const json = (status: number, body: unknown): HttpResponseInit => ({
  status,
  jsonBody: body,
  headers: { 'cache-control': 'no-store' },
});

function errorResponse(e: unknown, ctx: InvocationContext): HttpResponseInit {
  if (e instanceof StoreUnavailableError || e instanceof StoreNotConfiguredError) return json(503, { error: e.message });
  ctx.error('share failed', e);
  return json(500, { error: 'Server error' });
}

/** POST /api/share { tripId } — family only. Creates (or replaces) a share link and returns its token. */
export async function shareCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }
  const tripId = (body as { tripId?: unknown } | null)?.tripId;
  if (!isValidTripId(tripId)) return json(400, { error: 'tripId is required and must look like a trip record id' });
  try {
    const store = getStore();
    const h = householdId();
    const trip = await store.getRecord(h, 'trip', tripId);
    if (!trip) return json(404, { error: 'Trip not found' });
    const token = generateShareToken();
    await store.createShareLink(h, token, tripId, auth.principal.userId);
    return json(200, { token });
  } catch (e) {
    return errorResponse(e, ctx);
  }
}

/** DELETE /api/share/{token} — family only. Revoking an unknown token 404s; revoking twice is fine. */
export async function shareRevoke(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const token = req.params.token;
  if (!token) return json(400, { error: 'token is required' });
  try {
    const ok = await getStore().revokeShareLink(householdId(), token);
    if (!ok) return json(404, { error: 'Link not found' });
    return json(200, { revoked: true });
  } catch (e) {
    return errorResponse(e, ctx);
  }
}

/**
 * GET /api/share/{token} — public, no sign-in. Read-only itinerary: trip,
 * campground, a redacted reservation (no confirmation number or cost),
 * routes and pins. 404 for an unknown or revoked token.
 */
export async function shareGet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const token = req.params.token;
  if (!token) return json(400, { error: 'token is required' });
  try {
    const store = getStore();
    const h = householdId();
    const link = await store.getShareLink(h, token);
    if (!link || link.revoked) return json(404, { error: 'This link isn’t available. Ask for a new one.' });

    const tripRecord = await store.getRecord(h, 'trip', link.tripId);
    if (!tripRecord) return json(404, { error: 'This link isn’t available. Ask for a new one.' });
    const trip = tripRecord.data as { campgroundId?: string | null };

    const campground = trip.campgroundId ? await store.getRecord(h, 'campground', trip.campgroundId) : null;
    const reservations = await store.getRecordsByTripId(h, 'reservation', link.tripId);
    const routes = await store.getRecordsByTripId(h, 'route', link.tripId);
    const pins = await store.getRecordsByTripId(h, 'pin', link.tripId);

    return json(200, {
      trip: tripRecord.data,
      campground: campground?.data ?? null,
      reservation: reservations[0] ? redactReservation(reservations[0].data) : null,
      routes: routes.map((r) => r.data),
      pins: pins.map((p) => p.data),
    });
  } catch (e) {
    return errorResponse(e, ctx);
  }
}

// GET is public (SWA anonymous role); POST/DELETE authorize() themselves for the family role.
app.http('shareCreate', { route: 'share', methods: ['POST'], authLevel: 'anonymous', handler: shareCreate });
app.http('shareRevoke', { route: 'share/{token}', methods: ['DELETE'], authLevel: 'anonymous', handler: shareRevoke });
app.http('shareGet', { route: 'share/{token}', methods: ['GET'], authLevel: 'anonymous', handler: shareGet });
