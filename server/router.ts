import { allowedGisUrl, MAX_GIS_BYTES } from '../api/src/lib/gisProxy';
import { fetchFacilities, RidbUpstreamError } from '../api/src/lib/ridbClient';
import { fetchReportPdf, findSurveyReports } from '../api/src/lib/sdFishReports';
import { generateShareToken, isValidTripId, redactReservation } from '../api/src/lib/shareService';
import { parsePullQuery, parsePushBody } from '../api/src/lib/validate';
import { accessToken, verifyAccessJwt } from './access';
import { D1Store } from './d1Store';
import { householdFor, isOwner, type Env } from './env';

/**
 * The app's server on Cloudflare (Pages Functions). Cloudflare Access signs
 * people in by emailed code before any request reaches here; every private
 * route still checks Access's signed token itself.
 */

export interface Caller {
  email: string;
  household: string;
  owner: boolean;
}

const UA = 'CampPlanner/1.0 (family trip planner; reads public park, lake and boat launch data)';

const json = (status: number, body: unknown, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const NOT_CONFIGURED = () => new HttpError(503, 'No database yet: add a D1 database binding named DB (see docs/CLOUDFLARE.md).', 'not-configured');

// Who signed in recently, so we don't write to the database on every request.
const notedAt = new Map<string, number>();

async function identify(req: Request, env: Env, fetchFn: typeof fetch): Promise<Caller> {
  let email: string | null = null;
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    try {
      email = (await verifyAccessJwt(accessToken(req), env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, fetchFn))?.email ?? null;
    } catch {
      throw new HttpError(503, 'Couldn’t check your sign-in right now. Try again in a minute.');
    }
    if (!email) throw new HttpError(401, 'Sign in required');
  } else if (env.DEV_USER_EMAIL) {
    email = env.DEV_USER_EMAIL.toLowerCase();
  } else {
    throw new HttpError(503, 'Sign-in isn’t set up yet: add ACCESS_TEAM_DOMAIN and ACCESS_AUD (see docs/CLOUDFLARE.md).', 'auth-not-configured');
  }
  const caller = { email, household: householdFor(env, email), owner: isOwner(env, email) };
  if (env.DB && Date.now() - (notedAt.get(email) ?? 0) > 10 * 60_000) {
    notedAt.set(email, Date.now());
    await new D1Store(env.DB).notePerson(email, caller.household).catch(() => notedAt.delete(email));
  }
  return caller;
}

const storeOf = (env: Env) => {
  if (!env.DB) throw NOT_CONFIGURED();
  return new D1Store(env.DB);
};

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

/** Public: a read-only itinerary for a share link (no confirmation number or cost). */
async function shareGet(env: Env, token: string): Promise<Response> {
  const store = storeOf(env);
  const gone = () => json(404, { error: 'This link isn’t available. Ask for a new one.' });
  const link = await store.findShareLink(token);
  if (!link || link.revoked) return gone();
  const h = link.household;
  const trip = await store.getRecord(h, 'trip', link.tripId);
  if (!trip) return gone();
  const campgroundId = (trip.data as { campgroundId?: string | null }).campgroundId;
  const [campground, reservations, routes, pins] = await Promise.all([
    campgroundId ? store.getRecord(h, 'campground', campgroundId) : null,
    store.getRecordsByTripId(h, 'reservation', link.tripId),
    store.getRecordsByTripId(h, 'route', link.tripId),
    store.getRecordsByTripId(h, 'pin', link.tripId),
  ]);
  return json(200, {
    trip: trip.data,
    campground: campground?.data ?? null,
    reservation: reservations[0] ? redactReservation(reservations[0].data) : null,
    routes: routes.map((r) => r.data),
    pins: pins.map((p) => p.data),
  });
}

async function gis(url: URL, fetchFn: typeof fetch): Promise<Response> {
  const target = allowedGisUrl(url.searchParams.get('url'));
  if (!target) return json(400, { error: 'That map service address isn’t allowed.' });
  try {
    const res = await fetchFn(target.toString(), { signal: AbortSignal.timeout(25_000), headers: { accept: 'application/json', 'user-agent': UA } });
    const text = await res.text();
    if (text.length > MAX_GIS_BYTES) return json(502, { error: 'The map service sent too much data.' });
    if (!res.ok) return json(502, { error: `The map service answered ${res.status} ${res.statusText}`.trim() });
    return new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' } });
  } catch (e) {
    return json(502, { error: `Server couldn’t reach it (${e instanceof Error ? `${e.name}: ${e.message}` : 'unknown'}).` });
  }
}

async function ridb(url: URL, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const query = url.searchParams.get('query') ?? '';
  const state = (url.searchParams.get('state') ?? 'MN').toUpperCase();
  const limit = Number(url.searchParams.get('limit') ?? 20);
  if (query.length > 200) return json(400, { error: 'query must be 200 characters or fewer' });
  if (!/^[A-Z]{2}$/.test(state)) return json(400, { error: 'state must be a 2-letter code, e.g. MN' });
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return json(400, { error: 'limit must be 1–50' });
  if (!env.RIDB_API_KEY) {
    return json(503, { error: 'Recreation.gov search isn’t set up yet. Get a free RIDB API key at ridb.recreation.gov and add it as RIDB_API_KEY (see docs/CLOUDFLARE.md).' });
  }
  try {
    return json(200, { results: await fetchFacilities({ apiKey: env.RIDB_API_KEY, query, state, limit, fetchImpl: fetchFn }) });
  } catch (e) {
    if (e instanceof RidbUpstreamError) return json(502, { error: 'Recreation.gov (RIDB) lookup failed. Try again in a moment.' });
    throw e;
  }
}

async function sdfish(path: string, url: URL, fetchFn: typeof fetch): Promise<Response> {
  if (path === 'sdfish/list') {
    const water = (url.searchParams.get('water') ?? '').trim();
    if (!/^[\w .'()-]{2,60}$/.test(water)) return json(400, { error: 'Give a lake name.' });
    try {
      const found = await findSurveyReports(water, fetchFn);
      if (!found) return json(404, { error: `No lake survey report for “${water}” on GFP Fishery Reports.` });
      return json(200, { water, ...found }, 'private, max-age=86400');
    } catch (e) {
      return json(502, { error: `Couldn’t reach GFP Fishery Reports (${e instanceof Error ? e.message : 'unknown'}).` });
    }
  }
  const id = url.searchParams.get('id') ?? '';
  if (!/^\d{1,8}$/.test(id)) return json(400, { error: 'Bad report id.' });
  try {
    return new Response(await fetchReportPdf(id, fetchFn), { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, max-age=86400' } });
  } catch (e) {
    return json(502, { error: e instanceof Error ? e.message : 'Couldn’t fetch the report.' });
  }
}

async function route(req: Request, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const method = req.method.toUpperCase();
  const share = /^share\/([\w-]{16,128})$/.exec(path);

  // Public routes.
  if (path === 'health' && method === 'GET') {
    return json(200, { ok: true, store: env.DB ? 'd1' : 'not-configured', signIn: env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD ? 'access' : env.DEV_USER_EMAIL ? 'dev' : 'not-configured' });
  }
  if (share && method === 'GET') return shareGet(env, share[1]!);

  const me = await identify(req, env, fetchFn);

  if (path === 'login' && method === 'GET') {
    // Reached only after Cloudflare Access let the person in; go back to where they were.
    const next = url.searchParams.get('next') ?? '/';
    const safe = /^\/(?![/\\])[^\s]*$/.test(next) && !next.startsWith('/api/') ? next : '/';
    return new Response(null, { status: 302, headers: { location: safe, 'cache-control': 'no-store' } });
  }
  if (path === 'me' && method === 'GET') {
    return json(200, { email: me.email, owner: me.owner, family: me.household === 'family', store: env.DB ? 'd1' : 'not-configured' });
  }
  if (path === 'people' && method === 'GET') {
    if (!me.owner) return json(403, { error: 'Only the app owner can see who has signed in.' });
    return json(200, { people: await storeOf(env).listPeople() });
  }
  if (path === 'sync') {
    if (method === 'GET') {
      const q = parsePullQuery(url.searchParams.get('since'), url.searchParams.get('limit'));
      if (!q.ok) return json(400, { error: q.error });
      return json(200, await storeOf(env).pull(me.household, q.value.since, q.value.limit));
    }
    if (method === 'POST') {
      const parsed = parsePushBody(await body(req));
      if (!parsed.ok) return json(400, { error: parsed.error });
      return json(200, await storeOf(env).push(me.household, me.email, parsed.value));
    }
  }
  if (path === 'share' && method === 'POST') {
    const tripId = ((await body(req)) as { tripId?: unknown } | null)?.tripId;
    if (!isValidTripId(tripId)) return json(400, { error: 'tripId is required and must look like a trip record id' });
    const store = storeOf(env);
    if (!(await store.getRecord(me.household, 'trip', tripId))) return json(404, { error: 'Trip not found — let the phone finish syncing, then try again.' });
    const token = generateShareToken();
    await store.createShareLink(me.household, token, tripId, me.email);
    return json(200, { token });
  }
  if (share && method === 'DELETE') {
    if (!(await storeOf(env).revokeShareLink(me.household, share[1]!))) return json(404, { error: 'Link not found' });
    return json(200, { revoked: true });
  }
  if (path === 'gis' && method === 'GET') return gis(url, fetchFn);
  if (path === 'ridb/facilities' && method === 'GET') return ridb(url, env, fetchFn);
  if ((path === 'sdfish/list' || path === 'sdfish/pdf') && method === 'GET') return sdfish(path, url, fetchFn);
  if (path.startsWith('files/')) {
    return json(503, { error: 'Photo backup isn’t set up on this server; photos stay on the phone.', code: 'not-configured' });
  }
  return json(404, { error: 'Not found' });
}

/** Handle one /api/* request. Errors become JSON the app understands. */
export async function handleApi(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
  try {
    return await route(req, env, fetchFn);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
    console.error('api failed', e);
    return json(500, { error: 'Server error' });
  }
}
