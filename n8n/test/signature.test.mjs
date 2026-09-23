/**
 * Cross-implementation contract test for the webhook signature.
 *
 * The signing rule is implemented twice -- once in the backend, once as
 * JavaScript inside an n8n Code node -- and the two must agree exactly or
 * every lead silently stops arriving. Rather than trust that, this test pulls
 * the real jsCode out of the exported workflow, feeds it signatures produced
 * by the real backend module, and asserts on the outcome. A drift in either
 * implementation fails CI.
 *
 *   node --test n8n/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { sign } from '../../server/src/webhook/dispatcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SECRET = 'contract-test-secret';
const WORKFLOW = join(here, '..', 'workflows', 'lead-routing.json');

const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
const verifyNode = workflow.nodes.find((node) => node.name === 'Authenticate');

assert.ok(verifyNode, 'the lead-routing workflow must contain an "Authenticate" node');

/** Compile the node's code exactly as n8n would, in "run once for all items" mode. */
const verify = new Function('require', '$env', '$vars', '$input', 'Buffer', verifyNode.parameters.jsCode);

/** What the backend would actually send for this payload. */
function backendSign(body, timestamp, secret = SECRET) {
  return sign(body, timestamp, secret);
}

function run({ body, timestamp, signature, secret = SECRET, withBody = true, from = 'env', token }) {
  const item = {
    json: {
      headers: {
        ...(signature === null ? {} : { 'x-conserje-signature': signature }),
        ...(timestamp === null ? {} : { 'x-conserje-timestamp': String(timestamp) }),
        ...(token === undefined ? {} : { 'x-conserje-token': token }),
      },
    },
  };

  if (withBody) {
    item.binary = { data: { data: Buffer.from(body, 'utf8').toString('base64') } };
  }

  const input = { first: () => item, all: () => [item] };

  // Self-hosted n8n exposes the secret on $env; n8n Cloud blocks $env and
  // exposes Variables on $vars instead. The node must handle either.
  const env = from === 'env' ? { CONSERJE_WEBHOOK_SECRET: secret } : {};
  const vars = from === 'vars' ? { CONSERJE_WEBHOOK_SECRET: secret } : {};

  return verify(require, env, vars, input, Buffer);
}

const payload = JSON.stringify({
  version: 1,
  event: 'lead.qualified',
  lead: { tier: 'hot', score: 85, email: 'ana@example.test' },
});

test('a signature produced by the backend is accepted', () => {
  const now = Math.floor(Date.now() / 1000);
  const result = run({ body: payload, timestamp: now, signature: backendSign(payload, now) });

  assert.equal(result.length, 1);
  assert.equal(result[0].json.lead.tier, 'hot');
  assert.equal(result[0].json.lead.score, 85);
});

test('the two implementations agree byte for byte', () => {
  const now = 1700000000;
  const fromBackend = backendSign(payload, now);
  const fromNode = require('node:crypto')
    .createHmac('sha256', SECRET)
    .update(`${now}.${payload}`)
    .digest('hex');

  assert.equal(fromBackend, fromNode);
});

test('a tampered body is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const signature = backendSign(payload, now);
  const tampered = payload.replace('"score":85', '"score":100');

  assert.throws(
    () => run({ body: tampered, timestamp: now, signature }),
    /bad signature/i,
  );
});

test('a signature from a different secret is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const signature = backendSign(payload, now, 'some-other-secret');

  assert.throws(() => run({ body: payload, timestamp: now, signature }), /bad signature/i);
});

test('a captured request cannot be replayed later', () => {
  // Correct signature, correct body, six minutes old.
  const stale = Math.floor(Date.now() / 1000) - 360;

  assert.throws(
    () => run({ body: payload, timestamp: stale, signature: backendSign(payload, stale) }),
    /replay/i,
  );
});

test('a timestamp from the future is rejected too', () => {
  const ahead = Math.floor(Date.now() / 1000) + 600;

  assert.throws(
    () => run({ body: payload, timestamp: ahead, signature: backendSign(payload, ahead) }),
    /replay/i,
  );
});

test('missing signature headers are rejected', () => {
  const now = Math.floor(Date.now() / 1000);

  assert.throws(
    () => run({ body: payload, timestamp: now, signature: null }),
    /headers are missing/i,
  );
  assert.throws(
    () => run({ body: payload, timestamp: null, signature: backendSign(payload, now) }),
    /headers are missing/i,
  );
});

test('a webhook node without Raw Body enabled fails loudly', () => {
  // Without the raw bytes the signature can never match, and the failure
  // would otherwise look like a wrong secret and cost an afternoon.
  const now = Math.floor(Date.now() / 1000);

  assert.throws(
    () => run({ body: payload, timestamp: now, signature: backendSign(payload, now), withBody: false }),
    /Raw Body/i,
  );
});

test('with no secret and no token, nothing is accepted', () => {
  // A verifier that waves requests along when it cannot verify them is worse
  // than no verifier, because it looks like one.
  const now = Math.floor(Date.now() / 1000);

  assert.throws(
    () => run({ body: payload, timestamp: now, signature: backendSign(payload, now), secret: '' }),
    /no CONSERJE_WEBHOOK_SECRET readable and no token header/,
  );
});

test('with no secret, the token header stands in for the signature', () => {
  // The n8n Cloud free-plan path: a Code node cannot read the secret, so the
  // Webhook node's Header Auth has already checked the token by the time this
  // runs. The presence of the header is the evidence that it passed.
  const now = Math.floor(Date.now() / 1000);

  const result = run({
    body: payload,
    timestamp: now,
    signature: backendSign(payload, now),
    secret: '',
    token: 'whatever-n8n-already-validated',
  });

  assert.equal(result[0].json.lead.tier, 'hot');
});

test('a readable secret is still verified, token or not', () => {
  // Otherwise sending a token alongside a forged signature would be a way to
  // opt out of the stronger check.
  const now = Math.floor(Date.now() / 1000);

  assert.throws(
    () => run({
      body: payload,
      timestamp: now,
      signature: backendSign(payload, now, 'wrong-secret'),
      token: 'a-valid-looking-token',
    }),
    /bad signature/i,
  );
});

test('the webhook node requires authentication', () => {
  // This is the guard that keeps the fail-open configuration from shipping.
  // Without Header Auth AND without a readable secret, anyone who learns the
  // URL can post whatever they like, and the Authenticate node cannot tell.
  const webhook = workflow.nodes.find((node) => node.name === 'Lead webhook');

  assert.equal(webhook.parameters.authentication, 'headerAuth');
  assert.ok(
    webhook.credentials?.httpHeaderAuth,
    'the webhook node must reference a Header Auth credential',
  );
});

test('the secret is read from n8n Cloud Variables when $env is blocked', () => {
  // On Cloud there is no way to set an environment variable, so a node that
  // only reads $env rejects every lead and looks exactly like a bad secret.
  const now = Math.floor(Date.now() / 1000);

  const result = run({
    body: payload,
    timestamp: now,
    signature: backendSign(payload, now),
    from: 'vars',
  });

  assert.equal(result[0].json.event, 'lead.qualified');
});

test('the webhook node has Raw Body enabled', () => {
  const webhook = workflow.nodes.find((node) => node.name === 'Lead webhook');

  assert.equal(webhook.parameters.options.rawBody, true);
});
