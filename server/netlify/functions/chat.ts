/**
 * Netlify adapter.
 *
 * Everything interesting is in src/http/router.ts; this file exists to map the
 * platform's handler signature onto it and to turn a boot failure into a 503.
 */

import type { Config, Context } from '@netlify/functions';

import { boot } from '../../src/app.ts';
import { handleRequest } from '../../src/http/router.ts';

export default async (request: Request, context: Context): Promise<Response> => {
  try {
    const app = boot();

    // context.ip is resolved by the platform from the real connection, so
    // there is no forwarded header for a client to forge a fresh rate-limit
    // bucket with.
    return await handleRequest(app, request, context.ip || 'unknown');
  } catch (error) {
    // A boot failure means misconfiguration. Log the detail, tell the caller
    // nothing: the message could name an env var or a filesystem path.
    console.error(`[conserje] boot failed: ${String(error)}`);

    return new Response(
      JSON.stringify({ error: { code: 'unavailable', message: 'Service unavailable.', retryable: false } }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
};

export const config: Config = {
  path: ['/chat', '/health'],
};
