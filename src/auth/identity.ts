/**
 * Sign-in is handled in front of the app: Cloudflare Access (an emailed
 * one-time code) or, on the older Azure deployment, Static Web Apps
 * (Microsoft accounts). We cache the signed-in user so the app still knows
 * who you are with no cell service.
 */

export type Platform = 'cloudflare' | 'azure';

export interface User {
  userId: string;
  userDetails: string; // usually the email address
  identityProvider: string;
  userRoles: string[];
  /** Cloudflare: the app owner (sees who has signed in). */
  owner?: boolean;
  /** Cloudflare: false when this person has their own space instead of the family's trips. */
  sharesFamilyTrips?: boolean;
}

export type AuthState =
  | { kind: 'signed-in'; user: User; offline: boolean }
  /** `previousUser` is set when this phone was signed in before (session expired). */
  | { kind: 'signed-out'; previousUser: User | null }
  /** Running with `npm run dev` only — there is no login server. */
  | { kind: 'unavailable' };

const KEY = 'camp.user';
export const CLOUDFLARE_PROVIDER = 'cloudflare-access';

export function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function setCachedUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode — fine, we just won't remember */
  }
}

export const FAMILY_ROLE = 'family';

/** May use the sync server. On Cloudflare everyone who signs in can (each in their own space unless listed as family). */
export function isFamily(user: User): boolean {
  return user.userRoles.includes(FAMILY_ROLE);
}

let detected: Platform | null = null;

/** Which sign-in this deployment uses (Cloudflare unless the phone found Azure's). */
export function platform(): Platform {
  if (detected) return detected;
  const cached = getCachedUser();
  if (cached) return cached.identityProvider === CLOUDFLARE_PROVIDER ? 'cloudflare' : 'azure';
  return 'cloudflare';
}

const isRedirect = (res: Response) => res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
const isJson = (res: Response) => (res.headers.get('content-type') ?? '').includes('json');

interface Me {
  email: string;
  owner: boolean;
  family: boolean;
}

export function userFromMe(me: Me): User {
  return {
    userId: me.email,
    userDetails: me.email,
    identityProvider: CLOUDFLARE_PROVIDER,
    userRoles: [FAMILY_ROLE],
    owner: me.owner,
    sharesFamilyTrips: me.family,
  };
}

export async function loadAuth(fetchFn: typeof fetch = fetch): Promise<AuthState> {
  const offline = (): AuthState => {
    const cached = getCachedUser();
    return cached ? { kind: 'signed-in', user: cached, offline: true } : { kind: 'signed-out', previousUser: null };
  };
  // Weak signal can hang for a long time; after 6 s treat it as offline.
  const get = (url: string) => fetchFn(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(6_000) });

  try {
    // Azure Static Web Apps answers /.auth/me itself; elsewhere it's just the app page.
    const swa = await get('/.auth/me');
    if (swa.ok && isJson(swa)) {
      detected = 'azure';
      const user = ((await swa.json()) as { clientPrincipal: User | null }).clientPrincipal;
      if (!user) return { kind: 'signed-out', previousUser: getCachedUser() };
      setCachedUser(user);
      return { kind: 'signed-in', user, offline: false };
    }
    if (isRedirect(swa)) {
      // Cloudflare Access wants a fresh sign-in.
      detected = 'cloudflare';
      return { kind: 'signed-out', previousUser: getCachedUser() };
    }

    const res = await get('/api/me');
    if (isRedirect(res) || res.status === 401) {
      detected = 'cloudflare';
      return { kind: 'signed-out', previousUser: getCachedUser() };
    }
    if (!res.ok || !isJson(res)) return { kind: 'unavailable' };
    detected = 'cloudflare';
    const user = userFromMe((await res.json()) as Me);
    setCachedUser(user);
    return { kind: 'signed-in', user, offline: false };
  } catch {
    return offline();
  }
}

/** Where to send someone to sign in, coming back to this page. */
export function loginUrl(): string {
  const here = location.pathname + location.search;
  // /api/ isn't answered by the offline cache, so the request reaches Cloudflare Access, which asks for the email code.
  if (platform() === 'cloudflare') return `/api/login?next=${encodeURIComponent(here)}`;
  return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(location.pathname)}`;
}

export function logoutUrl(): string {
  return platform() === 'cloudflare' ? '/cdn-cgi/access/logout' : '/.auth/logout?post_logout_redirect_uri=/';
}

export const signInLabel = () => (platform() === 'cloudflare' ? 'Sign in with email' : 'Sign in with Microsoft');

export function forgetUser(): void {
  setCachedUser(null);
}
