/**
 * Per-site CORS, and the two response shapes the widget understands.
 *
 * The widget runs on the client's page, so the browser sends an Origin on
 * every call. Each site declares exactly which origins may embed it, and the
 * reflected value is always one from that list -- never the request's own
 * Origin echoed back, which would make the allowlist decorative.
 */

import { allowsOrigin, type SiteConfig } from '../config/site.ts';

const BASE_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export function corsHeaders(site: SiteConfig, origin: string | null): Record<string, string> | null {
  if (!allowsOrigin(site, origin)) {
    return null;
  }

  return {
    // Safe to assert: allowsOrigin only returns true for a non-null origin.
    'Access-Control-Allow-Origin': origin as string,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  };
}

export function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  retryable = false,
  extraHeaders: Record<string, string> = {},
): Response {
  return json({ error: { code, message, retryable } }, status, extraHeaders);
}

export function preflight(headers: Record<string, string>): Response {
  return new Response(null, { status: 204, headers });
}
