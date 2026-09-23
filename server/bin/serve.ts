/**
 * Local dev server.
 *
 * Runs the real router, service, prompt and model against a plain HTTP port,
 * with the platform's storage swapped for the in-memory stores -- Netlify
 * Blobs only exists inside a Netlify runtime. State therefore lives as long as
 * the process does, which is what you want while iterating on a prompt.
 *
 *   node --experimental-strip-types bin/serve.ts
 */

import { createServer } from 'node:http';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { build } from '../src/app.ts';
import { MemoryConversationStore } from '../src/conversation/store.ts';
import { MemoryRateLimiter } from '../src/ratelimit/limiter.ts';
import { handleRequest } from '../src/http/router.ts';
import { systemClock } from '../src/support/clock.ts';
import { LeadDelivery } from '../src/webhook/delivery.ts';
import { WebhookDispatcher } from '../src/webhook/dispatcher.ts';

const port = Number(process.env['PORT'] ?? 8000);

/** Undelivered leads land in var/spool/ so they are still inspectable. */
const spoolDir = join(import.meta.dirname, '..', 'var', 'spool');

const app = build({
  conversations: new MemoryConversationStore(systemClock),
  rateLimiter: new MemoryRateLimiter(systemClock),
  delivery: new LeadDelivery(
    new WebhookDispatcher(process.env['CONSERJE_WEBHOOK_SECRET'] ?? ''),
    () => ({
      setJSON: async (key, data) => {
        await mkdir(spoolDir, { recursive: true });
        await writeFile(join(spoolDir, `${key}.json`), JSON.stringify(data, null, 2));
      },
    }),
  ),
});

createServer(async (incoming, outgoing) => {
  const url = `http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`;
  const chunks: Buffer[] = [];

  for await (const chunk of incoming) {
    chunks.push(chunk as Buffer);
  }

  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const method = incoming.method ?? 'GET';

  const request = new Request(url, {
    method,
    headers: incoming.headers as Record<string, string>,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
  });

  const response = await handleRequest(app, request, incoming.socket.remoteAddress ?? 'unknown');

  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`conserje dev server on http://localhost:${port}`));
