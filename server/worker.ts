import type { Env } from './env';
import { handleApi } from './router';

interface WorkerEnv extends Env {
  /** The built app (dist/), served by Cloudflare's static assets. */
  ASSETS: { fetch(req: Request): Promise<Response> };
}

/**
 * Cloudflare Worker entry. Static files and app pages are served straight
 * from dist/ (see wrangler.jsonc); only /api/* runs this code.
 */
export default {
  fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },
};
