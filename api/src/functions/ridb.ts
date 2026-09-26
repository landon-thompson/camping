import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { authorize } from '../lib/principal';
import { fetchFacilities, RidbConfigError, RidbUpstreamError } from '../lib/ridbClient';

const MAX_QUERY_LEN = 200;
const MAX_LIMIT = 50;

const json = (status: number, body: unknown): HttpResponseInit => ({
  status,
  jsonBody: body,
  headers: { 'cache-control': 'no-store' },
});

interface ParsedQuery {
  query: string;
  state: string;
  limit: number;
}

function parseQuery(req: HttpRequest): { ok: true; value: ParsedQuery } | { ok: false; error: string } {
  const query = req.query.get('query') ?? '';
  const state = (req.query.get('state') ?? 'MN').toUpperCase();
  const limitRaw = req.query.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (query.length > MAX_QUERY_LEN) return { ok: false, error: `query must be ${MAX_QUERY_LEN} characters or fewer` };
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: 'state must be a 2-letter code, e.g. MN' };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be 1–${MAX_LIMIT}` };
  return { ok: true, value: { query, state, limit } };
}

/**
 * GET /api/ridb/facilities?query=&state=MN&limit= — a thin, read-only proxy in
 * front of the documented RIDB facilities search (see api/src/lib/ridbClient.ts).
 * We never book, scrape availability, or call any undocumented endpoint —
 * this only returns the same public facility search RIDB itself offers, so
 * the app can turn a search result into a deep link plus our own tracking.
 */
export const ridbFacilities = async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
  const auth = authorize(req.headers.get('x-ms-client-principal'));
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const parsed = parseQuery(req);
  if (!parsed.ok) return json(400, { error: parsed.error });

  const apiKey = process.env.RIDB_API_KEY;
  if (!apiKey) {
    return json(503, {
      error:
        'Recreation.gov search isn’t set up yet. Ask the app owner to get a free RIDB API key at ridb.recreation.gov and add it as the RIDB_API_KEY app setting (see docs/phase-3.md).',
    });
  }

  try {
    const results = await fetchFacilities({ apiKey, ...parsed.value });
    return json(200, { results });
  } catch (e) {
    if (e instanceof RidbConfigError) return json(503, { error: e.message });
    if (e instanceof RidbUpstreamError) {
      ctx.warn('RIDB upstream error', e);
      return json(502, { error: 'Recreation.gov (RIDB) lookup failed. Try again in a moment.' });
    }
    ctx.error('ridb facilities failed', e);
    return json(500, { error: 'Server error' });
  }
};

app.http('ridbFacilities', { route: 'ridb/facilities', methods: ['GET'], authLevel: 'anonymous', handler: ridbFacilities });
