import { app } from '@azure/functions';

/**
 * GET /api/health — public, and deliberately does NOT touch the database, so
 * pinging it can't use up the free database allowance or keep it awake.
 */
export const health = async () => ({
  status: 200,
  headers: { 'cache-control': 'no-store' },
  jsonBody: {
    ok: true,
    store: process.env.DATA_STORE === 'memory' ? 'memory' : process.env.SQL_CONNECTION_STRING ? 'sql' : 'not-configured',
  },
});

app.http('health', { route: 'health', methods: ['GET'], authLevel: 'anonymous', handler: health });
