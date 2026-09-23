import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { assistantMessage, Conversation, userMessage } from '../src/conversation/conversation.ts';
import { CONVERSATION_TTL_SECONDS, MemoryConversationStore } from '../src/conversation/store.ts';
import { MemoryRateLimiter } from '../src/ratelimit/limiter.ts';
import { frozenClock } from '../src/support/clock.ts';

const START = 1_700_000_000;

describe('ConversationStore', () => {
  let clock: ReturnType<typeof frozenClock>;
  let store: MemoryConversationStore;

  beforeEach(() => {
    clock = frozenClock(START);
    store = new MemoryConversationStore(clock);
  });

  test('a saved conversation round-trips', async () => {
    const conversation = Conversation.start('abc', 'site-a', START);
    conversation.append(userMessage('hola'));
    conversation.append(assistantMessage('¿en qué trabajas?'));

    await store.save(conversation);
    const found = await store.find('abc');

    assert.ok(found !== null);
    assert.equal(found.id, 'abc');
    assert.equal(found.siteId, 'site-a');
    assert.equal(found.messages.length, 2);
    assert.equal(found.messages[1]?.text, '¿en qué trabajas?');
  });

  test('an unknown id is absent, not an error', async () => {
    assert.equal(await store.find('nope'), null);
  });

  test('the closed flag and its reason survive a round-trip', async () => {
    const conversation = Conversation.start('abc', 'site-a', START);
    conversation.close('lead_recorded');

    await store.save(conversation);
    const found = await store.find('abc');

    assert.equal(found?.closed, true);
    assert.equal(found?.closedReason, 'lead_recorded');
  });

  test('a conversation past its TTL reads as absent', async () => {
    // A transcript that outlives its window is a privacy problem, so expiry
    // is enforced on read rather than trusted to a cleanup job.
    await store.save(Conversation.start('abc', 'site-a', START));

    clock.set(START + CONVERSATION_TTL_SECONDS + 1);

    assert.equal(await store.find('abc'), null);
  });

  test('saving does not hand out a live reference to the caller', async () => {
    // Otherwise a later append would mutate stored state without a save.
    const conversation = Conversation.start('abc', 'site-a', START);
    await store.save(conversation);

    conversation.append(userMessage('added after the save'));

    assert.equal((await store.find('abc'))?.messages.length, 0);
  });

  test('purge removes what is past the cutoff and keeps the rest', async () => {
    await store.save(Conversation.start('old', 'site-a', START));
    clock.set(START + 5_000);
    await store.save(Conversation.start('new', 'site-a', START + 5_000));

    clock.set(START + 10_000);
    const removed = await store.purgeOlderThan(6_000);

    assert.equal(removed, 1);
    assert.equal(await store.find('old'), null);
    assert.ok((await store.find('new')) !== null);
  });

  test('user turns count only the visitor messages', () => {
    const conversation = Conversation.start('abc', 'site-a', START);
    conversation.append(userMessage('one'));
    conversation.append(assistantMessage('reply'));
    conversation.append(userMessage('two'));

    assert.equal(conversation.userTurns(), 2);
  });

  test('stored state missing a field decodes rather than throwing', () => {
    // Records written before a field existed must still load.
    const conversation = Conversation.fromJSON({ id: 'abc', messages: [{ text: 'hi' }] });

    assert.equal(conversation.id, 'abc');
    assert.equal(conversation.closed, false);
    assert.equal(conversation.messages[0]?.role, 'user');
  });
});

describe('RateLimiter', () => {
  let clock: ReturnType<typeof frozenClock>;
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    clock = frozenClock(START);
    limiter = new MemoryRateLimiter(clock);
  });

  test('it allows up to the limit and then refuses', async () => {
    assert.equal(await limiter.allow('k', 2, 60), true);
    assert.equal(await limiter.allow('k', 2, 60), true);
    assert.equal(await limiter.allow('k', 2, 60), false);
  });

  test('keys are independent', async () => {
    await limiter.allow('a', 1, 60);

    assert.equal(await limiter.allow('a', 1, 60), false);
    assert.equal(await limiter.allow('b', 1, 60), true);
  });

  test('the window slides rather than resetting on a boundary', async () => {
    // A fixed bucket would let someone spend the whole allowance twice across
    // the boundary; a sliding window frees exactly one slot at a time.
    await limiter.allow('k', 2, 60);
    clock.set(START + 30);
    await limiter.allow('k', 2, 60);

    assert.equal(await limiter.allow('k', 2, 60), false);

    clock.set(START + 61);
    assert.equal(await limiter.allow('k', 2, 60), true, 'the first hit has aged out');
    assert.equal(await limiter.allow('k', 2, 60), false, 'the second has not');
  });

  test('a zero or negative limit refuses everything', async () => {
    assert.equal(await limiter.allow('k', 0, 60), false);
    assert.equal(await limiter.allow('k', -1, 60), false);
  });

  test('a refused request does not consume a slot', async () => {
    await limiter.allow('k', 1, 60);
    await limiter.allow('k', 1, 60);

    clock.set(START + 61);

    assert.equal(await limiter.allow('k', 1, 60), true);
  });
});
