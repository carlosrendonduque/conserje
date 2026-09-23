/**
 * The signature contract with n8n.
 *
 * `n8n/test/signature.test.mjs` runs the workflow's Code node against these
 * same rules; if the two ever drift, leads stop arriving and nothing in either
 * system reports an error.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sign, verify, WebhookDispatcher, WebhookError } from '../src/webhook/dispatcher.ts';

const SECRET = 'a-shared-secret';
const NOW = 1_700_000_000;

describe('webhook signature', () => {
  test('a signature the sender produced verifies', () => {
    const body = JSON.stringify({ event: 'lead.qualified' });

    assert.equal(verify(body, NOW, sign(body, NOW, SECRET), SECRET, NOW), true);
  });

  test('a changed body fails', () => {
    const signature = sign('{"a":1}', NOW, SECRET);

    assert.equal(verify('{"a":2}', NOW, signature, SECRET, NOW), false);
  });

  test('a changed timestamp fails', () => {
    // The timestamp is inside the signed material precisely so it cannot be
    // adjusted to refresh a captured request.
    const body = '{"a":1}';
    const signature = sign(body, NOW, SECRET);

    assert.equal(verify(body, NOW + 1, signature, SECRET, NOW), false);
  });

  test('the wrong secret fails', () => {
    const body = '{"a":1}';

    assert.equal(verify(body, NOW, sign(body, NOW, SECRET), 'other-secret', NOW), false);
  });

  test('a stale request is refused even with a correct signature', () => {
    // Without this, a captured payload stays replayable forever, because its
    // signature never stops being correct.
    const body = '{"a":1}';
    const signature = sign(body, NOW, SECRET);

    assert.equal(verify(body, NOW, signature, SECRET, NOW + 301), false);
    assert.equal(verify(body, NOW, signature, SECRET, NOW + 299), true);
  });

  test('clock skew is tolerated in both directions', () => {
    const body = '{"a":1}';
    const signature = sign(body, NOW, SECRET);

    assert.equal(verify(body, NOW, signature, SECRET, NOW - 299), true);
    assert.equal(verify(body, NOW, signature, SECRET, NOW - 301), false);
  });

  test('a signature of the wrong length is refused, not thrown at', () => {
    // timingSafeEqual throws on a length mismatch, so the length check has to
    // come first or a truncated signature becomes a 500.
    assert.equal(verify('{"a":1}', NOW, 'short', SECRET, NOW), false);
    assert.equal(verify('{"a":1}', NOW, '', SECRET, NOW), false);
  });

  test('dispatching without a secret refuses rather than sending unsigned', () => {
    const dispatcher = new WebhookDispatcher('');

    return assert.rejects(
      () => dispatcher.send('https://example.test/hook', { a: 1 }, NOW),
      WebhookError,
    );
  });
});
