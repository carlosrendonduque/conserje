/**
 * The HTTP surface.
 *
 * The PHP backend could only check this from outside, with a shell script
 * against a running server. Keeping the router a plain Request -> Response
 * function means routing, the origin allowlist, input validation and what
 * leaks into an error body are all covered here instead.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { App } from '../src/app.ts';
import { ChatService } from '../src/chat/service.ts';
import { MemoryConversationStore } from '../src/conversation/store.ts';
import { handleRequest } from '../src/http/router.ts';
import { MemoryRateLimiter, type RateLimiter } from '../src/ratelimit/limiter.ts';
import { frozenClock } from '../src/support/clock.ts';
import { FakeChatModel, makeSite, RecordingDelivery } from './support/fakes.ts';

const ORIGIN = 'https://example.test';
const CHAT = `https://api.test/chat?site=test-site`;

function buildApp(overrides: { model?: FakeChatModel; rateLimiter?: RateLimiter } = {}): App {
  const clock = frozenClock(1_700_000_000);
  const site = makeSite();
  const model = overrides.model ?? FakeChatModel.replying('What are you building?');

  return {
    sites: {
      get: (id) => (id === site.id ? site : undefined),
      ids: () => [site.id],
    },
    chat: new ChatService(model, new MemoryConversationStore(clock), new RecordingDelivery(), clock),
    rateLimiter: overrides.rateLimiter ?? new MemoryRateLimiter(clock),
    clock,
  };
}

/** response.json() is `unknown`; every assertion below wants a bag of fields. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type JsonBody = any;

const readJson = async (response: Response): Promise<JsonBody> => response.json();

const post = (app: App, body: unknown, url = CHAT, origin: string | null = ORIGIN) =>
  handleRequest(
    app,
    new Request(url, {
      method: 'POST',
      headers: origin === null ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', Origin: origin },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    '203.0.113.1',
  );

describe('router', () => {
  let app: App;

  beforeEach(() => {
    app = buildApp();
  });

  test('health reports the number of loaded sites', async () => {
    const response = await handleRequest(app, new Request('https://api.test/health'), '1.2.3.4');

    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { status: 'ok', sites: 1 });
  });

  test('an unknown route is a 404', async () => {
    const response = await handleRequest(app, new Request('https://api.test/nope'), '1.2.3.4');

    assert.equal(response.status, 404);
  });

  test('a trailing slash resolves to the same route', async () => {
    const response = await handleRequest(app, new Request('https://api.test/health/'), '1.2.3.4');

    assert.equal(response.status, 200);
  });

  test('an allowed origin passes preflight and is reflected exactly', async () => {
    const response = await handleRequest(
      app,
      new Request(CHAT, { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
      '1.2.3.4',
    );

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(response.headers.get('vary'), 'Origin');
  });

  test('a disallowed origin is refused', async () => {
    const response = await post(app, { message: 'hi' }, CHAT, 'https://not-allowed.invalid');

    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  test('a missing origin is refused', async () => {
    assert.equal((await post(app, { message: 'hi' }, CHAT, null)).status, 403);
  });

  test('an unknown site is refused the same way as a bad origin', async () => {
    // Otherwise the endpoint becomes a way to enumerate which tenants exist.
    const unknown = await post(app, { message: 'hi' }, 'https://api.test/chat?site=nope');
    const disallowed = await post(app, { message: 'hi' }, CHAT, 'https://not-allowed.invalid');

    assert.equal(unknown.status, 403);
    assert.deepEqual(await readJson(unknown), await readJson(disallowed));
  });

  test('GET is rejected', async () => {
    const response = await handleRequest(
      app,
      new Request(CHAT, { headers: { Origin: ORIGIN } }),
      '1.2.3.4',
    );

    assert.equal(response.status, 405);
  });

  test('malformed JSON is rejected', async () => {
    assert.equal((await post(app, 'not json')).status, 400);
  });

  test('an empty message is rejected', async () => {
    const response = await post(app, { message: '   ' });

    assert.equal(response.status, 400);
    assert.equal((await readJson(response)).error.code, 'empty_message');
  });

  test('a body that is not an object is treated as an empty message', async () => {
    assert.equal((await post(app, '[1,2,3]')).status, 400);
    assert.equal((await post(app, 'null')).status, 400);
  });

  test('a successful turn returns the session and the reply', async () => {
    const response = await post(app, { message: 'I need a website' });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.reply, 'What are you building?');
    assert.equal(body.done, false);
    assert.match(body.session, /^[a-f0-9]{32}$/);
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  });

  test('the rate limiter refuses before the model is called', async () => {
    const model = FakeChatModel.replying('never reached');
    const limited = buildApp({ model, rateLimiter: { allow: async () => false } });

    const response = await post(limited, { message: 'hi' });

    assert.equal(response.status, 429);
    assert.equal((await readJson(response)).error.retryable, true);
    assert.equal(model.calls, 0);
  });

  test('CORS headers are present on errors too', async () => {
    // Without them the browser hides the status and the widget cannot tell a
    // rate limit from an outage.
    const response = await post(app, { message: '' });

    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  });

  test('an upstream failure surfaces as a retryable 503, with no detail', async () => {
    const failing = buildApp({ model: FakeChatModel.failing(true) });

    const response = await post(failing, { message: 'hi' });
    const body = await readJson(response);

    assert.equal(response.status, 503);
    assert.equal(body.error.retryable, true);
    assert.ok(!JSON.stringify(body).includes('fake failure'), 'internal detail must not leak');
  });

  test('no response body ever carries the score or a credential shape', async () => {
    const recording = buildApp({
      model: FakeChatModel.recordingLead('Thanks.', {
        need: 'A booking system for my clinic that syncs with the calendar',
        email: 'ana@clinic.test',
        budgetBand: 'over-40k',
      }),
    });

    const text = await (await post(recording, { message: 'hi' })).text();

    assert.ok(!text.includes('score'));
    assert.ok(!text.includes('tier'));
    assert.ok(!text.includes('sk-ant'));
  });
});
