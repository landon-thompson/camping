import { beforeEach, describe, expect, it } from 'vitest';
import { resetAccessKeyCache, verifyAccessJwt } from './access';
import type { Env } from './env';
import { handleApi } from './router';
import { memoryD1 } from './testing/d1Shim';

const TEAM = 'campers.cloudflareaccess.com';
const AUD = 'aud-tag-123';

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };

async function token(claims: Record<string, unknown>, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 3600, iat: now, email: 'Owner@Example.com', ...claims }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

let certFetches = 0;
const upstream = (async (url: string | URL) => {
  const u = String(url);
  if (u === `https://${TEAM}/cdn-cgi/access/certs`) {
    certFetches++;
    return Response.json({ keys: [publicJwk] });
  }
  if (u.startsWith('https://apps.sd.gov/GF56FisheriesReports/ExportPDF.ashx')) return new Response(new Uint8Array([37, 80, 68, 70]));
  if (u.startsWith('https://apps.sd.gov/')) return new Response('<tr><td>Lake Survey 2021</td><td><a href="ExportPDF.ashx?ReportID=28627">Roy (2021)</a></td></tr>');
  if (u.startsWith('https://services.arcgis.com/')) return Response.json({ features: [] });
  return new Response('nope', { status: 500 });
}) as typeof fetch;

const env = (more: Partial<Env> = {}): Env => ({ DB: memoryD1(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: 'owner@example.com', FAMILY_EMAILS: 'spouse@example.com', ...more });
const call = async (e: Env, path: string, init: RequestInit & { jwt?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.jwt) headers.set('cf-access-jwt-assertion', init.jwt);
  const res = await handleApi(new Request(`https://camp.pages.dev${path}`, { ...init, headers }), e, upstream);
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? ((await res.json()) as Record<string, unknown>) : await res.arrayBuffer(), res };
};

beforeEach(() => {
  resetAccessKeyCache();
  certFetches = 0;
});

describe('Cloudflare Access sign-in token', () => {
  it('accepts a valid token and refuses tampered, expired or foreign ones', async () => {
    expect(await verifyAccessJwt(await token({}), TEAM, AUD, upstream)).toEqual({ email: 'owner@example.com' });
    const t = await token({});
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: 9e9, email: 'evil@x.com' }))}.${s}`;
    expect(await verifyAccessJwt(forged, TEAM, AUD, upstream)).toBeNull();
    expect(await verifyAccessJwt(await token({ exp: Math.floor(Date.now() / 1000) - 120 }), TEAM, AUD, upstream)).toBeNull();
    expect(await verifyAccessJwt(await token({ aud: ['other-app'] }), TEAM, AUD, upstream)).toBeNull();
    expect(await verifyAccessJwt(await token({ iss: 'https://other.cloudflareaccess.com' }), TEAM, AUD, upstream)).toBeNull();
    expect(await verifyAccessJwt(await token({}, 'unknown-key'), TEAM, AUD, upstream)).toBeNull();
    expect(await verifyAccessJwt('not.a.jwt', TEAM, AUD, upstream)).toBeNull();
    expect(await verifyAccessJwt(null, TEAM, AUD, upstream)).toBeNull();
    expect(certFetches).toBeLessThanOrEqual(3); // cached, refetched only for an unknown key
  });
});

describe('Cloudflare API', () => {
  it('needs a sign-in for private routes; health and share links are public', async () => {
    const e = env();
    expect((await call(e, '/api/health')).body).toEqual({ ok: true, store: 'd1', signIn: 'access' });
    expect((await call(e, '/api/me')).status).toBe(401);
    expect((await call(e, '/api/sync')).status).toBe(401);
    expect((await call(e, '/api/share/abcdefghijklmnopqrstuvwxyz')).status).toBe(404);
    const noAuth = await call(env({ ACCESS_TEAM_DOMAIN: undefined }), '/api/me');
    expect(noAuth).toMatchObject({ status: 503, body: { code: 'auth-not-configured' } });
    const dev = await call(env({ ACCESS_TEAM_DOMAIN: undefined, DEV_USER_EMAIL: 'me@dev.test' }), '/api/me');
    expect(dev.body).toMatchObject({ email: 'me@dev.test', owner: false, family: false });
  });

  it('owner and family share trips; anyone else gets their own space; owner sees who signed in', async () => {
    const e = env();
    const owner = await token({});
    const spouse = await token({ email: 'spouse@example.com' });
    const stranger = await token({ email: 'friend@example.com' });
    expect((await call(e, '/api/me', { jwt: owner })).body).toMatchObject({ email: 'owner@example.com', owner: true, family: true });

    const push = await call(e, '/api/sync', {
      jwt: owner,
      method: 'POST',
      body: JSON.stringify({ records: [{ id: 'trip:1', type: 'trip', data: { name: 'Bear Head', campgroundId: null }, updatedAt: 1, deleted: false }] }),
    });
    expect(push.body).toMatchObject({ accepted: [{ id: 'trip:1' }], rejected: [] });
    expect(((await call(e, '/api/sync?since=0', { jwt: spouse })).body as { records: unknown[] }).records).toHaveLength(1);
    expect(((await call(e, '/api/sync?since=0', { jwt: stranger })).body as { records: unknown[] }).records).toHaveLength(0);
    expect((await call(e, '/api/sync', { jwt: owner, method: 'POST', body: '{bad' })).status).toBe(400);

    const people = await call(e, '/api/people', { jwt: owner });
    expect((people.body as { people: { email: string; household: string }[] }).people.map((p) => [p.email, p.household]).sort()).toEqual([
      ['friend@example.com', 'person:friend@example.com'],
      ['owner@example.com', 'family'],
      ['spouse@example.com', 'family'],
    ]);
    expect((await call(e, '/api/people', { jwt: spouse })).status).toBe(403);

    const login = await call(e, `/api/login?next=${encodeURIComponent('/trips/abc?x=1')}`, { jwt: spouse });
    expect([login.status, login.res.headers.get('location')]).toEqual([302, '/trips/abc?x=1']);
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/api/sync'])
      expect((await call(e, `/api/login?next=${encodeURIComponent(bad)}`, { jwt: spouse })).res.headers.get('location')).toBe('/');
    // A share link's page has no Access header (bypassed), but the browser still sends the sign-in cookie.
    expect((await call(e, '/api/me', { headers: { cookie: `theme=dim; CF_Authorization=${owner}` } })).body).toMatchObject({ owner: true });

    const share = await call(e, '/api/share', { jwt: spouse, method: 'POST', body: JSON.stringify({ tripId: 'trip:1' }) });
    const tok = (share.body as { token: string }).token;
    expect(tok).toMatch(/^[\w-]{40,}$/);
    expect((await call(e, `/api/share/${tok}`)).body).toMatchObject({ trip: { name: 'Bear Head' }, reservation: null, routes: [], pins: [] });
    expect((await call(e, `/api/share/${tok}`, { jwt: stranger, method: 'DELETE' })).status).toBe(404);
    expect((await call(e, `/api/share/${tok}`, { jwt: owner, method: 'DELETE' })).body).toEqual({ revoked: true });
    expect((await call(e, `/api/share/${tok}`)).status).toBe(404);
    expect((await call(e, '/api/share', { jwt: stranger, method: 'POST', body: JSON.stringify({ tripId: 'trip:1' }) })).status).toBe(404);
  });

  it('runs on-this-phone mode without a database, and proxies only allowed public data', async () => {
    const jwt = await token({});
    const noDb = env({ DB: undefined });
    expect(await call(noDb, '/api/sync', { jwt })).toMatchObject({ status: 503, body: { code: 'not-configured' } });
    expect((await call(noDb, '/api/me', { jwt })).body).toMatchObject({ store: 'not-configured' });

    const ok = await call(noDb, `/api/gis?url=${encodeURIComponent('https://services.arcgis.com/abc/arcgis/rest/services/X/FeatureServer/0/query?f=json&where=1=1')}`, { jwt });
    expect(ok).toMatchObject({ status: 200, body: { features: [] } });
    expect((await call(noDb, `/api/gis?url=${encodeURIComponent('https://evil.example.com/x')}`, { jwt })).status).toBe(400);
    expect((await call(noDb, '/api/ridb/facilities?query=bear', { jwt })).status).toBe(503);
    expect((await call(noDb, '/api/files/upload-url', { jwt, method: 'POST' })).body).toMatchObject({ code: 'not-configured' });

    const list = await call(noDb, '/api/sdfish/list?water=Roy+Lake', { jwt });
    expect(list.body).toMatchObject({ reportId: '28627', water: 'Roy Lake' });
    const pdf = await call(noDb, '/api/sdfish/pdf?id=28627', { jwt });
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(pdf.body as ArrayBuffer)).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect((await call(noDb, '/api/sdfish/pdf?id=../x', { jwt })).status).toBe(400);
    expect((await call(noDb, '/api/nothing', { jwt })).status).toBe(404);
  });
});
