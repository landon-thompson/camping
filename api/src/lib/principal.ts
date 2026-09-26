/**
 * Azure Static Web Apps signs users in and forwards who they are in the
 * `x-ms-client-principal` header (base64 JSON). Only SWA can set it: requests
 * from the internet go through SWA, which strips any client-supplied copy.
 */
export interface Principal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

export const FAMILY_ROLE = 'family';

export function parsePrincipal(header: string | null | undefined): Principal | null {
  if (!header) return null;
  try {
    const json = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Partial<Principal>;
    if (typeof json.userId !== 'string' || !json.userId) return null;
    return {
      userId: json.userId,
      userDetails: typeof json.userDetails === 'string' ? json.userDetails : '',
      identityProvider: typeof json.identityProvider === 'string' ? json.identityProvider : '',
      userRoles: Array.isArray(json.userRoles) ? json.userRoles.filter((r) => typeof r === 'string') : [],
    };
  } catch {
    return null;
  }
}

export type AuthResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401 | 403; error: string };

/** Only invited family members (role `family`) may read or write data. */
export function authorize(header: string | null | undefined): AuthResult {
  const principal = parsePrincipal(header);
  if (!principal) return { ok: false, status: 401, error: 'Sign in required' };
  if (!principal.userRoles.includes(FAMILY_ROLE)) {
    return {
      ok: false,
      status: 403,
      error: 'This account has not been invited. Ask the app owner for a family invitation link.',
    };
  }
  return { ok: true, principal };
}
