import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { ChatError, EMPTY_MESSAGE, MESSAGE_TOO_LONG, TURN_LIMIT, UPSTREAM_UNAVAILABLE } from '../src/chat/errors.ts';
import { ChatService, toResponseBody } from '../src/chat/service.ts';
import { MemoryConversationStore } from '../src/conversation/store.ts';
import { TIER_HOT } from '../src/qualification/lead.ts';
import { frozenClock } from '../src/support/clock.ts';
import { FakeChatModel, makeSite, RecordingDelivery } from './support/fakes.ts';

describe('ChatService', () => {
  let clock: ReturnType<typeof frozenClock>;
  let store: MemoryConversationStore;

  beforeEach(() => {
    clock = frozenClock(1_700_000_000);
    store = new MemoryConversationStore(clock);
  });

  const build = (model: FakeChatModel, delivery = new RecordingDelivery()) =>
    [new ChatService(model, store, delivery, clock), delivery] as const;

  test('it starts a session and returns the reply', async () => {
    const [service] = build(FakeChatModel.replying('What are you building?'));

    const result = await service.handle(makeSite(), null, 'I need a website');

    assert.notEqual(result.sessionId, '');
    assert.equal(result.reply, 'What are you building?');
    assert.equal(result.done, false);
  });

  test('it continues an existing session', async () => {
    const model = FakeChatModel.replying('First?', 'Second?');
    const [service] = build(model);
    const site = makeSite();

    const first = await service.handle(site, null, 'hello');
    const second = await service.handle(site, first.sessionId, 'a shop site');

    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.reply, 'Second?');

    // The second model call must see the whole transcript so far: two visitor
    // messages and the assistant turn between them.
    assert.equal(model.seen[1]?.messages.length, 3);
  });

  test('a session from another site is never reused', async () => {
    // Otherwise a session id leaked from one tenant would read another
    // tenant's transcript.
    const model = FakeChatModel.replying('One?', 'Two?');
    const [service] = build(model);

    const first = await service.handle(makeSite({ id: 'site-a' }), null, 'hi');
    const second = await service.handle(makeSite({ id: 'site-b' }), first.sessionId, 'hi');

    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(model.seen[1]?.messages.length, 1);
  });

  test('an unknown session id starts a fresh conversation', async () => {
    const [service] = build(FakeChatModel.replying('Hello?'));
    const unknown = 'f'.repeat(32);

    const result = await service.handle(makeSite(), unknown, 'hi');

    assert.notEqual(result.sessionId, unknown);
    assert.equal(result.done, false);
  });

  test('it rejects an empty message before spending a model call', async () => {
    const model = FakeChatModel.replying('never reached');
    const [service] = build(model);

    await assert.rejects(
      () => service.handle(makeSite(), null, '   \n  '),
      (error: ChatError) => error.errorCode === EMPTY_MESSAGE,
    );

    assert.equal(model.calls, 0);
  });

  test('it rejects an oversized message before spending a model call', async () => {
    const model = FakeChatModel.replying('never reached');
    const [service] = build(model);
    const site = makeSite({ maxMessageChars: 50 });

    await assert.rejects(
      () => service.handle(site, null, 'x'.repeat(51)),
      (error: ChatError) => error.errorCode === MESSAGE_TOO_LONG && error.status === 400,
    );

    assert.equal(model.calls, 0);
  });

  test('the message cap counts characters, not UTF-16 units', async () => {
    // '👋' is two UTF-16 units but one character to a person, and the cap is
    // quoted to the visitor in characters.
    const model = FakeChatModel.replying('ok');
    const [service] = build(model);
    const site = makeSite({ maxMessageChars: 4 });

    const result = await service.handle(site, null, '👋👋👋👋');

    assert.equal(result.reply, 'ok');
  });

  test('the turn cap closes the conversation without calling the model', async () => {
    const site = makeSite({ maxTurns: 2 });
    const model = FakeChatModel.replying('One?', 'Two?', 'Three?');
    const [service] = build(model);

    const first = await service.handle(site, null, 'a');
    await service.handle(site, first.sessionId, 'b');
    const third = await service.handle(site, first.sessionId, 'c');

    assert.equal(third.done, true);
    assert.equal(third.doneReason, TURN_LIMIT);
    assert.equal(model.calls, 2, 'the cap must bite before the third call');
  });

  test('a closed conversation cannot be reopened', async () => {
    const site = makeSite();
    const [service] = build(
      FakeChatModel.recordingLead('Got it.', { need: 'a shop', email: 'a@b.test' }),
    );

    const first = await service.handle(site, null, 'hi');
    assert.equal(first.done, true);

    await assert.rejects(
      () => service.handle(site, first.sessionId, 'one more thing'),
      /already finished/,
    );
  });

  test('recording a lead scores it and dispatches it', async () => {
    const site = makeSite();
    const [service, delivery] = build(
      FakeChatModel.recordingLead('Thanks, someone will be in touch.', {
        need: 'A booking system for my clinic, integrated with the calendar',
        email: 'ana@clinic.test',
        phone: '+57 300 000 0000',
        company: 'Clinic',
        timeline: 'this month',
        budgetBand: '15k-40k',
        summary: 'Clinic wants online booking.',
      }),
    );

    const result = await service.handle(site, null, 'I need online booking');

    assert.equal(result.done, true);
    assert.equal(result.doneReason, 'lead_recorded');
    assert.equal(delivery.delivered.length, 1);

    const lead = delivery.delivered[0]!.lead;
    assert.equal(lead.email, 'ana@clinic.test');
    assert.equal(lead.tier, TIER_HOT);
    assert.ok(lead.score >= 70);
  });

  test('the lead never reaches the browser', async () => {
    // The score is the routing rule. Publishing it tells anyone watching the
    // network tab exactly what to say to get flagged hot.
    const site = makeSite();
    const [service] = build(
      FakeChatModel.recordingLead('Thanks.', {
        need: 'x',
        email: 'a@b.test',
        budgetBand: 'over-40k',
      }),
    );

    const body = toResponseBody(await service.handle(site, null, 'hi'));

    assert.deepEqual(Object.keys(body), ['session', 'reply', 'done', 'reason']);
    assert.ok(!JSON.stringify(body).includes('score'));
  });

  test('a delivery outage does not break the visitor experience', async () => {
    const site = makeSite();
    const [service, delivery] = build(
      FakeChatModel.recordingLead('Thanks.', { need: 'x', email: 'a@b.test' }),
      new RecordingDelivery(false),
    );

    const result = await service.handle(site, null, 'hi');

    assert.equal(result.done, true);
    assert.equal(result.reply, 'Thanks.');
    assert.equal(delivery.delivered.length, 1);
  });

  test('a tool call with no usable need is discarded', async () => {
    const site = makeSite();
    const [service, delivery] = build(
      FakeChatModel.recordingLead('Thanks.', { email: 'a@b.test' }),
    );

    const result = await service.handle(site, null, 'hi');

    assert.equal(result.done, true);
    assert.equal(result.lead, null);
    assert.equal(delivery.delivered.length, 0, 'nothing routable, nothing dispatched');
  });

  test('an upstream failure does not persist the visitor turn', async () => {
    // Otherwise a retry would send the same message twice and the model would
    // see a duplicated transcript.
    const site = makeSite();
    const [ok] = build(FakeChatModel.replying('Hello?'));
    const started = await ok.handle(site, null, 'hi');

    const [failing] = build(FakeChatModel.failing(true));

    await assert.rejects(
      () => failing.handle(site, started.sessionId, 'this one blows up'),
      (error: ChatError) =>
        error.errorCode === UPSTREAM_UNAVAILABLE && error.status === 503 && error.retryable,
    );

    const stored = await store.find(started.sessionId);
    assert.ok(stored !== null);
    assert.equal(stored.messages.length, 2, 'the failed turn must not be recorded');
  });

  test('a non-retryable upstream failure is reported as such', async () => {
    const [service] = build(FakeChatModel.failing(false));

    await assert.rejects(
      () => service.handle(makeSite(), null, 'hi'),
      (error: ChatError) => error.retryable === false,
    );
  });
});
