import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  hasContact,
  leadFromToolInput,
  TIER_WARM,
  UnusableLeadError,
} from '../src/qualification/lead.ts';

const build = (input: Record<string, unknown>) => leadFromToolInput(input, 50, TIER_WARM);

describe('Lead', () => {
  test('a lead with no usable need is rejected', () => {
    // Nothing downstream can act on a lead that does not say what is wanted.
    assert.throws(() => build({ email: 'a@b.test' }), UnusableLeadError);
    assert.throws(() => build({ need: '   ' }), UnusableLeadError);
    assert.throws(() => build({ need: 42 }), UnusableLeadError);
  });

  test('the summary falls back to the need when the model omits it', () => {
    const lead = build({ need: 'A shop' });

    assert.equal(lead.summary, 'A shop');
  });

  test('a syntactically invalid address is dropped rather than propagated', () => {
    // Downstream automation would bounce on it anyway, and a half-valid
    // address in a CRM is worse than an empty field.
    assert.equal(build({ need: 'x', email: 'not-an-address' }).email, null);
    assert.equal(build({ need: 'x', email: 'a@b' }).email, null);
    assert.equal(build({ need: 'x', email: 'a b@c.test' }).email, null);
    assert.equal(build({ need: 'x', email: 'ana@clinic.test' }).email, 'ana@clinic.test');
  });

  test('every text field is length-capped', () => {
    const lead = build({ need: 'n'.repeat(900), summary: 's'.repeat(2000) });

    assert.equal(lead.need.length, 600);
    assert.equal(lead.summary.length, 1000);
  });

  test('blank strings become null rather than empty fields', () => {
    const lead = build({ need: 'x', name: '  ', company: '', phone: '\n' });

    assert.equal(lead.name, null);
    assert.equal(lead.company, null);
    assert.equal(lead.phone, null);
  });

  test('values are trimmed', () => {
    const lead = build({ need: '  a shop  ', name: ' Ana ' });

    assert.equal(lead.need, 'a shop');
    assert.equal(lead.name, 'Ana');
  });

  test('a non-string from the model is treated as absent, not coerced', () => {
    const lead = build({ need: 'x', name: 42, phone: { a: 1 }, company: [] });

    assert.equal(lead.name, null);
    assert.equal(lead.phone, null);
    assert.equal(lead.company, null);
  });

  test('reachability means an address or a phone number', () => {
    assert.equal(hasContact(build({ need: 'x' })), false);
    assert.equal(hasContact(build({ need: 'x', email: 'a@b.test' })), true);
    assert.equal(hasContact(build({ need: 'x', phone: '300' })), true);
    assert.equal(hasContact(build({ need: 'x', email: 'bad' })), false);
  });

  test('the score and tier come from the caller, never from the model', () => {
    // The model is never asked for a number; if it volunteers one it must be
    // ignored, or routing becomes a thing the visitor can talk their way into.
    const lead = leadFromToolInput({ need: 'x', score: 100, tier: 'hot' }, 50, TIER_WARM);

    assert.equal(lead.score, 50);
    assert.equal(lead.tier, TIER_WARM);
  });
});
