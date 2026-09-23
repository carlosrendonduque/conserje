/**
 * Sliding-window rate limiter.
 *
 * A model call costs real money, so this is the difference between a widget
 * and an open wallet. The window is exact rather than a fixed bucket: a fixed
 * bucket lets someone spend the whole allowance twice across a boundary.
 *
 * The file lock the PHP implementation used has no equivalent on a platform
 * that runs each request in its own isolate, so concurrency is handled with
 * optimistic writes instead: read the window with its etag, prune, write back
 * conditionally, and retry if someone else won the race. After the retries are
 * spent the request is refused rather than waved through -- a limiter that
 * fails open is not a limiter.
 */

import { lazyStore, type LazyStore } from '../support/lazy-store.ts';
import { createHash } from 'node:crypto';

import type { Clock } from '../support/clock.ts';

export interface RateLimiter {
  /**
   * Record a hit against the key and report whether it is within the limit.
   * Resolves false once the caller has exceeded `limit` hits in `windowSeconds`.
   */
  allow(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

const MAX_ATTEMPTS = 3;

export class BlobRateLimiter implements RateLimiter {
  readonly #store: LazyStore;
  readonly #clock: Clock;

  constructor(clock: Clock, store: LazyStore = lazyStore('conserje-ratelimit')) {
    this.#store = store;
    this.#clock = clock;
  }

  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (limit <= 0) {
      return false;
    }

    const blobKey = createHash('sha256').update(key).digest('hex');

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const existing = await this.#store().getWithMetadata(blobKey, { type: 'json' });
      const now = this.#clock.now();
      const hits = prune(existing?.data, now - windowSeconds);

      if (hits.length >= limit) {
        return false;
      }

      hits.push(now);

      try {
        const result = await this.#store().setJSON(blobKey, hits, writeGuard(existing, existing?.etag));

        if (result.modified) {
          return true;
        }
      } catch {
        // Treat a transport failure the same as a lost race: try again, and
        // fall through to the refusal below if it keeps failing.
      }
    }

    return false;
  }
}

/** For tests, and for `netlify dev` runs that should not touch real storage. */
export class MemoryRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, number[]>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (limit <= 0) {
      return false;
    }

    const now = this.#clock.now();
    const hits = prune(this.#windows.get(key), now - windowSeconds);

    if (hits.length >= limit) {
      this.#windows.set(key, hits);

      return false;
    }

    hits.push(now);
    this.#windows.set(key, hits);

    return true;
  }
}

/**
 * Turn the etag we read into the condition the write must satisfy.
 *
 * No record yet means the write must be the one that creates it. A record with
 * an etag means the write must find that exact version still in place. A
 * record the backend gave us no etag for is the awkward case: there is nothing
 * to make the write conditional on, so it goes through unguarded and that one
 * request carries a small chance of racing. Refusing instead would hand any
 * caller a way to disable their own limiter by racing it on purpose.
 */
function writeGuard(
  existing: unknown,
  etag: string | undefined,
): { onlyIfNew: true } | { onlyIfMatch: string } | undefined {
  if (existing === null) {
    return { onlyIfNew: true };
  }

  return etag === undefined ? undefined : { onlyIfMatch: etag };
}

/** Timestamps still inside the window, oldest first. */
function prune(raw: unknown, cutoff: number): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((hit): hit is number => typeof hit === 'number' && Number.isFinite(hit) && hit > cutoff)
    .sort((a, b) => a - b);
}
