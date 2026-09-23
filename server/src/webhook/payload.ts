/**
 * The contract between this backend and n8n.
 *
 * Shape changes here are breaking changes for every workflow downstream, so
 * the version field is part of the payload and the tests assert the keys.
 */

import type { SiteConfig } from '../config/site.ts';
import type { Conversation } from '../conversation/conversation.ts';
import type { Lead } from '../qualification/lead.ts';

export const PAYLOAD_VERSION = 1;

export interface WebhookPayload {
  readonly version: number;
  readonly event: 'lead.qualified';
  readonly timestamp: number;
  readonly site: { readonly id: string; readonly name: string; readonly locale: string };
  readonly lead: Lead;
  readonly conversation: {
    readonly id: string;
    readonly startedAt: number;
    readonly turns: number;
    readonly transcript: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  };
}

export function buildPayload(
  lead: Lead,
  site: SiteConfig,
  conversation: Conversation,
  timestamp: number,
): WebhookPayload {
  return {
    version: PAYLOAD_VERSION,
    event: 'lead.qualified',
    timestamp,
    site: { id: site.id, name: site.name, locale: site.locale },
    lead,
    conversation: {
      id: conversation.id,
      startedAt: conversation.createdAt,
      turns: conversation.userTurns(),
      // The full transcript travels with the lead: whoever picks it up should
      // be able to read what was actually said rather than trust the summary.
      transcript: conversation.messages.map((m) => ({ role: m.role, text: m.text })),
    },
  };
}
