/**
 * Spool replay: undelivered leads are retried hourly, but not forever.
 *
 * The failure this guards against is a receiver that acts on the lead -- sends
 * the Telegram alert -- and then fails to answer 2xx. Uncapped, that re-sends
 * the same alert every hour until someone deletes the blob by hand.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { SiteConfig } from '../src/config/site.ts';
import type { SiteRepository } from '../src/config/sites.ts';
import { MAX_REPLAY_ATTEMPTS, replaySpool, type SpooledLead } from '../src/webhook/delivery.ts';
import { WebhookDispatcher } from '../src/webhook/dispatcher.ts';

class MemoryStore {
  readonly data = new Map<string, unknown>();

  async list(): Promise<{ blobs: Array<{ key: string }> }> {
    return { blobs: [...this.data.keys()].map((key) => ({ key })) };
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key) ?? null;
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const sites = {
  get: (id: string) => (id === 'demo' ? ({ id, webhookUrlEnv: 'TEST_WEBHOOK_URL' } as SiteConfig) : undefined),
} as SiteRepository;

const record = (attempts?: number): SpooledLead =>
  ({
    siteId: 'demo',
    reason: 'timeout',
    spooledAt: 1_700_000_000,
    payload: { event: 'lead.qualified' },
    ...(attempts === undefined ? {} : { attempts }),
  }) as unknown as SpooledLead;

const quiet = (): void => {};
const realFetch = globalThis.fetch;

function respondWith(status: number): void {
  globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
}

describe('replaySpool', () => {
  let spool: MemoryStore;
  let dead: MemoryStore;
  const dispatcher = new WebhookDispatcher('secret');

  beforeEach(() => {
    spool = new MemoryStore();
    dead = new MemoryStore();
    process.env['TEST_WEBHOOK_URL'] = 'https://n8n.test/webhook';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env['TEST_WEBHOOK_URL'];
  });

  test('a delivered lead leaves the spool', async () => {
    respondWith(200);
    await spool.setJSON('k', record());

    const result = await replaySpool(dispatcher, spool, dead, sites, quiet);

    assert.deepEqual(result, { delivered: 1, failed: 0, abandoned: 0 });
    assert.equal(spool.data.size, 0);
  });

  test('a failed replay stays spooled and counts the attempt', async () => {
    respondWith(500);
    await spool.setJSON('k', record());

    const result = await replaySpool(dispatcher, spool, dead, sites, quiet);

    assert.deepEqual(result, { delivered: 0, failed: 1, abandoned: 0 });
    assert.equal((spool.data.get('k') as SpooledLead).attempts, 1);
  });

  test('the last allowed failure moves the lead to dead letters', async () => {
    respondWith(500);
    await spool.setJSON('k', record(MAX_REPLAY_ATTEMPTS - 1));

    const result = await replaySpool(dispatcher, spool, dead, sites, quiet);

    assert.deepEqual(result, { delivered: 0, failed: 0, abandoned: 1 });
    assert.equal(spool.data.size, 0);
    assert.equal((dead.data.get('k') as SpooledLead).attempts, MAX_REPLAY_ATTEMPTS);
  });

  test('a site with no webhook URL also runs out of attempts', async () => {
    delete process.env['TEST_WEBHOOK_URL'];
    await spool.setJSON('k', record(MAX_REPLAY_ATTEMPTS - 1));

    const result = await replaySpool(dispatcher, spool, dead, sites, quiet);

    assert.equal(result.abandoned, 1);
    assert.equal(dead.data.has('k'), true);
  });
});
