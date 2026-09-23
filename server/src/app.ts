/**
 * Wires the object graph, once per cold start.
 *
 * Small enough not to warrant a DI container, explicit enough that the
 * dependencies of every component are readable in one place. A boot failure is
 * cached alongside the success: a misconfigured deployment should fail the
 * same way on every request rather than re-reading the filesystem each time.
 */

import Anthropic from '@anthropic-ai/sdk';

import { ChatService } from './chat/service.ts';
import { loadSites, type SiteRepository } from './config/sites.ts';
import { BlobConversationStore, type ConversationStore } from './conversation/store.ts';
import { ClaudeChatModel } from './llm/claude.ts';
import { BlobRateLimiter, type RateLimiter } from './ratelimit/limiter.ts';
import { systemClock, type Clock } from './support/clock.ts';
import { LeadDelivery } from './webhook/delivery.ts';
import { WebhookDispatcher } from './webhook/dispatcher.ts';

export interface App {
  readonly sites: SiteRepository;
  readonly chat: ChatService;
  readonly rateLimiter: RateLimiter;
  readonly clock: Clock;
}

let cached: App | undefined;
let bootError: unknown;

export function boot(): App {
  if (cached !== undefined) {
    return cached;
  }

  if (bootError !== undefined) {
    throw bootError;
  }

  try {
    cached = build();

    return cached;
  } catch (error) {
    bootError = error;

    throw error;
  }
}

/**
 * Storage the caller supplies instead of the platform's.
 *
 * Netlify Blobs only exists inside a Netlify runtime, so `bin/serve.ts` swaps
 * in the in-memory stores to run the real model against a local port. Nothing
 * else about the graph changes, which is the point: the dev server exercises
 * the same router, the same service and the same prompt as production.
 */
export interface StorageOverrides {
  conversations?: ConversationStore;
  rateLimiter?: RateLimiter;
  delivery?: LeadDelivery;
}

export function build(overrides: StorageOverrides = {}): App {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const clock = systemClock;

  const conversations = overrides.conversations ?? new BlobConversationStore(clock);
  const delivery =
    overrides.delivery ??
    new LeadDelivery(
      new WebhookDispatcher(
        process.env['CONSERJE_WEBHOOK_SECRET'] ?? '',
        process.env['CONSERJE_WEBHOOK_TOKEN'] ?? '',
      ),
    );

  return {
    sites: loadSites(),
    chat: new ChatService(new ClaudeChatModel(new Anthropic({ apiKey })), conversations, delivery, clock),
    rateLimiter: overrides.rateLimiter ?? new BlobRateLimiter(clock),
    clock,
  };
}

/** Reset between tests; production never calls this. */
export function resetForTests(): void {
  cached = undefined;
  bootError = undefined;
}

function requireEnv(key: string): string {
  const value = process.env[key];

  if (typeof value !== 'string' || value === '') {
    throw new Error(`Required environment variable '${key}' is not set.`);
  }

  return value;
}
