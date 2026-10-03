/**
 * fetch for the app's own /api. On Cloudflare, an expired sign-in makes Access
 * answer with a redirect to its login page, which a background request can't
 * follow; report that as 401 (sign in again) instead of a confusing network error.
 */
export async function apiFetch(input: string, init?: RequestInit, fetchFn: typeof fetch = fetch): Promise<Response> {
  const res = await fetchFn(input, { credentials: 'same-origin', redirect: 'manual', ...init });
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  return res;
}
