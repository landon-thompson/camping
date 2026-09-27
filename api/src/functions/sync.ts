import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { authorize } from '../lib/principal';
import { getStore, householdId, StoreNotConfiguredError } from '../lib/storeFactory';
import { StoreUnavailableError } from '../lib/sqlStore';
import { parsePullQuery, parsePushBody } from '../lib/validate';

// Remember recent members so we don't write to the database on every request.
const MEMBER_REFRESH_MS = 10 * 60_000;
const memberSeenAt = new Map<string, number>();

const json = (status: number, body: unknown): HttpResponseInit => ({
  status,
  jsonBody: body,
  headers: { 'cache-control': 'no-store' },
});

async function handle(
  req: HttpRequest,
  ctx: InvocationContext,
  fn: (userId: string) => Promise<HttpResponseInit>,
): Promise<HttpResponseInit> {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });
  try {
    const store = getStore();
    const seen = memberSeenAt.get(auth.principal.userId) ?? 0;
    if (Date.now() - seen > MEMBER_REFRESH_MS) {
      await store.ensureMember(householdId(), {
        userId: auth.principal.userId,
        email: auth.principal.userDetails,
        identityProvider: auth.principal.identityProvider,
      });
      memberSeenAt.set(auth.principal.userId, Date.now());
    }
    return await fn(auth.principal.userId);
  } catch (e) {
    if (e instanceof StoreNotConfiguredError) {
      // No database set up (yet): the app runs in on-this-phone mode.
      return json(503, { error: e.message, code: 'not-configured' });
    }
    if (e instanceof StoreUnavailableError) {
      return json(503, { error: e.message });
    }
    ctx.error('sync failed', e);
    return json(500, { error: 'Server error' });
  }
}

/** GET /api/sync?since=<cursor>&limit=<n> — changes since the cursor. */
export const syncPull = (req: HttpRequest, ctx: InvocationContext) =>
  handle(req, ctx, async () => {
    const q = parsePullQuery(req.query.get('since'), req.query.get('limit'));
    if (!q.ok) return json(400, { error: q.error });
    return json(200, await getStore().pull(householdId(), q.value.since, q.value.limit));
  });

/** POST /api/sync { records: [...] } — upload local edits. */
export const syncPush = (req: HttpRequest, ctx: InvocationContext) =>
  handle(req, ctx, async (userId) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Body must be JSON' });
    }
    const parsed = parsePushBody(body);
    if (!parsed.ok) return json(400, { error: parsed.error });
    return json(200, await getStore().push(householdId(), userId, parsed.value));
  });

// Access is enforced by Static Web Apps roles (staticwebapp.config.json) *and* authorize().
app.http('syncPull', { route: 'sync', methods: ['GET'], authLevel: 'anonymous', handler: syncPull });
app.http('syncPush', { route: 'sync', methods: ['POST'], authLevel: 'anonymous', handler: syncPush });
