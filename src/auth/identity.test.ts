import { describe, expect, it } from 'vitest';
import { loadAuth } from './identity';

const html = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
const redirect = () => Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' });
const fake = (routes: Record<string, () => Response>) => (async (url: string) => (routes[url] ?? html)()) as typeof fetch;

describe('finding out who is signed in', () => {
  it('Cloudflare: reads /api/me', async () => {
    const auth = await loadAuth(fake({ '/api/me': () => Response.json({ email: 'friend@x.com', owner: false, family: false }) }));
    expect(auth).toMatchObject({ kind: 'signed-in', offline: false, user: { userDetails: 'friend@x.com', userRoles: ['family'], owner: false, sharesFamilyTrips: false } });
  });

  it('Cloudflare: an expired sign-in shows up as a redirect to the login page', async () => {
    expect(await loadAuth(fake({ '/.auth/me': redirect }))).toEqual({ kind: 'signed-out', previousUser: null });
    expect(await loadAuth(fake({ '/api/me': redirect }))).toEqual({ kind: 'signed-out', previousUser: null });
  });

  it('Azure: reads /.auth/me', async () => {
    const principal = { userId: 'u1', userDetails: 'me@x.com', identityProvider: 'aad', userRoles: ['family'] };
    expect(await loadAuth(fake({ '/.auth/me': () => Response.json({ clientPrincipal: principal }) }))).toMatchObject({ kind: 'signed-in', user: principal });
    expect(await loadAuth(fake({ '/.auth/me': () => Response.json({ clientPrincipal: null }) }))).toMatchObject({ kind: 'signed-out' });
  });

  it('no server (npm run dev) and offline', async () => {
    expect(await loadAuth(fake({}))).toEqual({ kind: 'unavailable' });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await loadAuth(offline)).toEqual({ kind: 'signed-out', previousUser: null });
  });
});
