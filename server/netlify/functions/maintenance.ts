/**
 * Scheduled maintenance: replay undelivered leads, drop expired transcripts.
 *
 * The PHP backend shipped these as CLI scripts and told the operator to wire
 * them into cron. There is no machine to put a crontab on any more, and a
 * maintenance job nobody scheduled is a maintenance job nobody runs -- so the
 * schedule lives in the code.
 *
 * Runs hourly. Spool replay is the part that matters: those are real leads
 * that failed delivery, and they are the entire point of the product.
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

import { loadSites } from '../../src/config/sites.ts';
import { BlobConversationStore, CONVERSATION_TTL_SECONDS } from '../../src/conversation/store.ts';
import { systemClock } from '../../src/support/clock.ts';
import { replaySpool } from '../../src/webhook/delivery.ts';
import { WebhookDispatcher } from '../../src/webhook/dispatcher.ts';

export default async (): Promise<Response> => {
  const dispatcher = new WebhookDispatcher(
    process.env['CONSERJE_WEBHOOK_SECRET'] ?? '',
    process.env['CONSERJE_WEBHOOK_TOKEN'] ?? '',
  );

  const spool = await replaySpool(dispatcher, getStore('conserje-spool'), loadSites());
  const purged = await new BlobConversationStore(systemClock).purgeOlderThan(CONVERSATION_TTL_SECONDS);

  console.log(
    `[conserje] maintenance: ${spool.delivered} leads delivered, ${spool.failed} still spooled, ` +
      `${purged} conversations purged`,
  );

  return new Response(null, { status: 204 });
};

export const config: Config = {
  schedule: '@hourly',
};
