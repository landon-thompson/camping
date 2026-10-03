/**
 * Cloudflare Access puts a signed token (JWT) on every request it lets through,
 * in the `Cf-Access-Jwt-Assertion` header. We check its signature against the
 * team's public keys, plus audience, issuer and expiry, so a request that
 * somehow skipped Access (or forged the header) is refused.
 */

export interface AccessIdentity {
  email: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

const KEY_TTL_MS = 60 * 60_000;
let keyCache: { team: string; at: number; keys: Map<string, CryptoKey> } | null = null;

export function resetAccessKeyCache() {
  keyCache = null;
}

const b64urlBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

export const teamUrl = (team: string) => `https://${team.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

async function keysFor(team: string, fetchFn: typeof fetch, refresh = false): Promise<Map<string, CryptoKey>> {
  if (!refresh && keyCache && keyCache.team === team && Date.now() - keyCache.at < KEY_TTL_MS) return keyCache.keys;
  const res = await fetchFn(`${teamUrl(team)}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access keys answered ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache = { team, at: Date.now(), keys };
  return keys;
}

/** The signed-in person's email, or null if the token is missing or not valid for this app. */
export async function verifyAccessJwt(
  token: string | null | undefined,
  team: string,
  aud: string,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
): Promise<AccessIdentity | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
  try {
    header = b64urlJson(h) as typeof header;
    payload = b64urlJson(p) as typeof payload;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let keys = await keysFor(team, fetchFn);
  if (!keys.has(header.kid)) keys = await keysFor(team, fetchFn, true); // keys rotate
  const key = keys.get(header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.iss !== teamUrl(team)) return null;
  const sec = now / 1000;
  if (typeof payload.exp !== 'number' || payload.exp < sec - 30) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > sec + 30) return null;
  if (typeof payload.email !== 'string' || !payload.email.includes('@')) return null;
  return { email: payload.email.toLowerCase() };
}

/** Access also sets a CF_Authorization cookie; use it if the header is missing. */
export function accessToken(req: Request): string | null {
  const h = req.headers.get('cf-access-jwt-assertion');
  if (h) return h;
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get('cookie') ?? '');
  return m ? decodeURIComponent(m[1]!) : null;
}
