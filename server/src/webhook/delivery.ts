/**
 * Hands a qualified lead to whatever picks it up downstream, and makes sure a
 * failed delivery is recoverable.
 *
 * The visitor's side of the transaction is already complete by the time this
 * runs, so an n8n outage must not lose the lead and must not produce an error
 * the visitor can see. Anything that fails to deliver is written to a spool
 * store and can be replayed later.
 *
 * Implementations must not throw: return false and preserve the lead.
 */

import { randomBytes } from 'node:crypto';

import { lazyStore, type LazyStore } from '../support/lazy-store.ts';

import type { SiteConfig } from '../config/site.ts';
import type { SiteRepository } from '../config/sites.ts';
import type { Conversation } from '../conversation/conversation.ts';
import type { Lead } from '../qualification/lead.ts';
import { buildPayload, type WebhookPayload } from './payload.ts';
import { WebhookDispatcher } from './dispatcher.ts';

export interface LeadDeliverer {
  deliver(lead: Lead, site: SiteConfig, conversation: Conversation, now: number): Promise<boolean>;
}

/**
 * Where a lead goes when it could not be delivered.
 *
 * Narrow on purpose: a Netlify `Store` satisfies it, and so does anything else
 * that can durably accept a JSON record -- which is what the dev server and
 * the tests need.
 */
export interface SpoolSink {
  setJSON(key: string, data: unknown): Promise<unknown>;
}

export interface SpooledLead {
  readonly siteId: string;
  readonly reason: string;
  readonly spooledAt: number;
  readonly payload: WebhookPayload;
}

export class LeadDelivery implements LeadDeliverer {
  readonly #dispatcher: WebhookDispatcher;
  readonly #spool: () => SpoolSink;
  readonly #log: (message: string) => void;

  constructor(
    dispatcher: WebhookDispatcher,
    spool: () => SpoolSink = lazyStore('conserje-spool') as LazyStore,
    log: (message: string) => void = console.error,
  ) {
    this.#dispatcher = dispatcher;
    this.#spool = spool;
    this.#log = log;
  }

  async deliver(
    lead: Lead,
    site: SiteConfig,
    conversation: Conversation,
    now: number,
  ): Promise<boolean> {
    const payload = buildPayload(lead, site, conversation, now);
    const url = process.env[site.webhookUrlEnv];

    if (typeof url !== 'string' || url.trim() === '') {
      await this.#spoolLead(site.id, payload, `no URL in $${site.webhookUrlEnv}`, now);

      return false;
    }

    try {
      await this.#dispatcher.send(url, payload, now);

      return true;
    } catch (error) {
      await this.#spoolLead(site.id, payload, String((error as Error).message ?? error), now);

      return false;
    }
  }

  async #spoolLead(
    siteId: string,
    payload: WebhookPayload,
    reason: string,
    now: number,
  ): Promise<void> {
    this.#log(`[conserje] lead delivery failed for site '${siteId}': ${reason}`);

    const key = `${now}-${siteId}-${randomBytes(4).toString('hex')}`;
    const record: SpooledLead = { siteId, reason, spooledAt: now, payload };

    try {
      await this.#spool().setJSON(key, record);
    } catch (cause) {
      // Last resort: the lead is gone from storage, so at least put it where
      // an operator reading logs can still recover the contact details.
      this.#log(`[conserje] could not spool the lead: ${String(cause)}`);
      this.#log(`[conserje] unspooled lead payload: ${JSON.stringify(record)}`);
    }
  }
}

/**
 * Re-dispatch everything sitting in the spool.
 *
 * Leads land there when n8n is down, misconfigured, or rejecting the payload,
 * and they are the whole point of the product -- so this runs on a schedule
 * rather than waiting for someone to notice and run a script. A lead that
 * still cannot be delivered stays put: the next run tries again.
 */
export async function replaySpool(
  dispatcher: WebhookDispatcher,
  spool: SpoolReader,
  sites: SiteRepository,
  log: (message: string) => void = console.error,
): Promise<{ delivered: number; failed: number }> {
  const { blobs } = await spool.list();
  let delivered = 0;
  let failed = 0;

  for (const blob of blobs) {
    const record = (await spool.get(blob.key, { type: 'json' })) as SpooledLead | null;

    if (record === null || typeof record !== 'object' || !('payload' in record)) {
      continue;
    }

    // Which variable holds the URL is the site config's to say -- guessing it
    // from the id would quietly break the moment a site names it differently.
    const site = sites.get(record.siteId);
    const url = site === undefined ? undefined : process.env[site.webhookUrlEnv];

    if (typeof url !== 'string' || url.trim() === '') {
      log(`[conserje] spool: no webhook URL for site '${record.siteId}', leaving ${blob.key} in place`);
      failed += 1;
      continue;
    }

    try {
      // Signed with a fresh timestamp: the original is long outside the
      // replay window the receiver enforces, so re-sending it as-is would be
      // rejected as a replay attack -- which, from the receiver's side, is
      // exactly what it would look like.
      await dispatcher.send(url, record.payload, Math.floor(Date.now() / 1000));
      await spool.delete(blob.key);
      delivered += 1;
    } catch (error) {
      log(`[conserje] spool replay failed for ${blob.key}: ${String((error as Error).message)}`);
      failed += 1;
    }
  }

  return { delivered, failed };
}

/** What replaySpool needs from a store; a Netlify `Store` satisfies it. */
export interface SpoolReader {
  list(): Promise<{ blobs: Array<{ key: string }> }>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  delete(key: string): Promise<void>;
}
