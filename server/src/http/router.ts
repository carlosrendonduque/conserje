/**
 * Two routes: POST /chat for a conversation turn, GET /health for uptime
 * checks.
 *
 * Kept as a plain Request -> Response function with the app and the caller's
 * IP passed in, so the whole surface -- routing, the origin allowlist, input
 * validation, what leaks into an error body -- is testable without a platform
 * around it. The Netlify handler is a four-line adapter over this.
 */

import type { App } from '../app.ts';
import { ChatError, RATE_LIMITED } from '../chat/errors.ts';
import { toResponseBody } from '../chat/service.ts';
import { corsHeaders, errorResponse, json, preflight } from './responses.ts';

export async function handleRequest(app: App, request: Request, ip: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/health') {
    return json({ status: 'ok', sites: app.sites.ids().length });
  }

  if (path !== '/chat') {
    return errorResponse('not_found', 'No such endpoint.', 404);
  }

  const origin = request.headers.get('origin');

  // The site id arrives as a query parameter so that it is available on the
  // preflight request, which carries no body.
  const site = app.sites.get(url.searchParams.get('site') ?? '');

  // Same response for an unknown site and a disallowed origin, so the endpoint
  // cannot be used to enumerate which tenants exist.
  const cors = site === undefined ? null : corsHeaders(site, origin);

  if (site === undefined || cors === null) {
    return errorResponse('forbidden', 'Not allowed from this origin.', 403);
  }

  if (request.method === 'OPTIONS') {
    return preflight(cors);
  }

  if (request.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Use POST.', 405, false, cors);
  }

  if (!(await app.rateLimiter.allow(`${site.id}:${ip}`, site.requestsPerHour, 3600))) {
    return errorResponse(RATE_LIMITED, 'Too many messages. Try again shortly.', 429, true, cors);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse('bad_request', 'Body must be JSON.', 400, false, cors);
  }

  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const message = typeof record['message'] === 'string' ? record['message'] : '';
  const session = typeof record['session'] === 'string' ? record['session'] : null;

  try {
    const result = await app.chat.handle(site, session, message);

    return json(toResponseBody(result), 200, cors);
  } catch (error) {
    if (error instanceof ChatError) {
      return errorResponse(error.errorCode, error.message, error.status, error.retryable, cors);
    }

    console.error(`[conserje] unhandled: ${String(error)}`);

    return errorResponse('internal_error', 'Something went wrong.', 500, true, cors);
  }
}
