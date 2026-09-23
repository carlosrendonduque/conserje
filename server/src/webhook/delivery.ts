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
