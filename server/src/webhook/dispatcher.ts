/**
 * Delivers qualified leads to n8n over a signed POST.
 *
 * An n8n webhook URL is effectively public: anyone who learns it can post to
 * it. So every request carries an HMAC-SHA256 signature over
 * `timestamp.body`, and the workflow verifies it before touching the payload.
 * Including the timestamp inside the signed material is what stops a captured
 * request from being replayed later.
 *
 * The signature covers the exact bytes this function sends, and n8n verifies
 * against the exact bytes it receives, so the two never have to agree on how a
 * given object serialises -- only that nothing re-encodes it in between.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Conserje-Signature';
export const TIMESTAMP_HEADER = 'X-Conserje-Timestamp';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_TOLERANCE_SECONDS = 300;

export class WebhookError extends Error {
  override readonly name = 'WebhookError';
}

/** Signature material is `timestamp.body`, hex-encoded HMAC-SHA256. */
export function sign(body: string, timestamp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Reference verifier, mirrored by the Code node in the n8n workflow. Kept here
 * so the two implementations can be diffed against one test.
 */
export function verify(
  body: string,
  timestamp: number,
  signature: string,
  secret: string,
  now: number,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = Buffer.from(sign(body, timestamp, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');

  // Length is checked first because timingSafeEqual throws on a mismatch.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class WebhookDispatcher {
  readonly #secret: string;
  readonly #timeoutMs: number;

  constructor(secret: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.#secret = secret;
    this.#timeoutMs = timeoutMs;
  }

  async send(url: string, payload: unknown, timestamp: number): Promise<void> {
    if (this.#secret === '') {
      throw new WebhookError('Refusing to dispatch: no webhook secret configured.');
    }

    let body: string;

    try {
      body = JSON.stringify(payload);
    } catch (cause) {
      throw new WebhookError('Could not encode webhook payload.', { cause });
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: sign(body, timestamp, this.#secret),
          [TIMESTAMP_HEADER]: String(timestamp),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw new WebhookError(`Webhook transport failed: ${String(cause)}`, { cause });
    }

    if (!response.ok) {
      throw new WebhookError(`Webhook rejected the payload with HTTP ${response.status}.`);
    }
  }
}
