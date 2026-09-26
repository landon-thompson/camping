/**
 * Sign-in is handled by Azure Static Web Apps (Microsoft accounts). We cache the
 * signed-in user so the app still knows who you are with no cell service.
 */

export interface User {
  userId: string;
  userDetails: string; // usually the email address
  identityProvider: string;
  userRoles: string[];
}

export type AuthState =
  | { kind: 'signed-in'; user: User; offline: boolean }
  /** `previousUser` is set when this phone was signed in before (session expired). */
  | { kind: 'signed-out'; previousUser: User | null }
  /** Running with `npm run dev` only — there is no login server. */
  | { kind: 'unavailable' };

const KEY = 'camp.user';

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

export function isFamily(user: User): boolean {
  return user.userRoles.includes(FAMILY_ROLE);
}

export async function loadAuth(): Promise<AuthState> {
  let res: Response;
  try {
    // Weak signal can hang for a long time; after 6 s treat it as offline.
    res = await fetch('/.auth/me', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(6_000) });
  } catch {
    const cached = getCachedUser();
    return cached ? { kind: 'signed-in', user: cached, offline: true } : { kind: 'signed-out', previousUser: null };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('json')) return { kind: 'unavailable' };
  const body = (await res.json()) as { clientPrincipal: User | null };
  const user = body.clientPrincipal;
  if (!user) return { kind: 'signed-out', previousUser: getCachedUser() };
  setCachedUser(user);
  return { kind: 'signed-in', user, offline: false };
}

export function loginUrl(): string {
  return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(location.pathname)}`;
}

export function logoutUrl(): string {
  return '/.auth/logout?post_logout_redirect_uri=/';
}

export function forgetUser(): void {
  setCachedUser(null);
}
