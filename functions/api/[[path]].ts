import type { Env } from '../../server/env';
import { handleApi } from '../../server/router';

/** Cloudflare Pages Functions entry: every /api/* request goes to the app's server. */
export const onRequest = (context: { request: Request; env: Env }): Promise<Response> => handleApi(context.request, context.env);
