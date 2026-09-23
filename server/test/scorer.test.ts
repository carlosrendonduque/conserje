import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { TIER_COLD, TIER_HOT, TIER_WARM } from '../src/qualification/lead.ts';
import { score, tierFor } from '../src/qualification/scorer.ts';
import { makeSite } from './support/fakes.ts';

const site = makeSite();

describe('LeadScorer', () => {
  test('an empty extraction scores zero and routes cold', () => {
    const value = score({}, site);

    assert.equal(value, 0);
    assert.equal(tierFor(value, site), TIER_COLD);
  });

  test('budget position in the band list drives the budget points', () => {
    // Four bands: index 0 of 3 is 0 points, index 3 of 3 is the full 45.
    assert.equal(score({ budgetBand: 'under-5k' }, site), 0);
    assert.equal(score({ budgetBand: 'over-40k' }, site), 45);
    assert.equal(score({ budgetBand: '5k-15k' }, site), 15);
  });

  test('a single-band site gives the full budget weight', () => {
    const oneBand = makeSite({ budgetBands: ['any'] });

    assert.equal(score({ budgetBand: 'any' }, oneBand), 45);
  });

  test('an unrecognised band scores as if budget was never stated', () => {
    // The model is told to use the labels verbatim; anything else is a
    // hallucinated label and must not be allowed to inflate the score.
    assert.equal(score({ budgetBand: 'a-million-dollars' }, site), 0);
  });

  test('urgency beats a stated date beats vagueness beats silence', () => {
    const points = (timeline: unknown) => score({ timeline }, site);

    assert.equal(points('we need this ASAP'), 30);
    assert.equal(points('next month'), 20);
    assert.equal(points('in the autumn'), 12);
    assert.equal(points('just exploring'), 5);
    assert.equal(points(null), 0);
  });

  test('Spanish timelines match with or without accents', () => {
    assert.equal(score({ timeline: 'urgente' }, site), 30);
    assert.equal(score({ timeline: 'próximo mes' }, site), 20);
    assert.equal(score({ timeline: 'proximo mes' }, site), 20);
    assert.equal(score({ timeline: 'sin prisa' }, site), 5);
  });

  test('two ways to reach someone beat one, and one beats none', () => {
    assert.equal(score({ email: 'a@b.test', phone: '300' }, site), 15);
    assert.equal(score({ email: 'a@b.test' }, site), 10);
    assert.equal(score({ phone: '300' }, site), 10);
    assert.equal(score({}, site), 0);
  });

  test('a malformed address is not a way to reach anyone', () => {
    assert.equal(score({ email: 'not-an-address' }, site), 0);
  });

  test('a company and a specific brief each add context points', () => {
    const vague = { need: 'a website' };
    const specific = { need: 'A booking system for my clinic that syncs with Google Calendar' };

    assert.equal(score(vague, site), 0);
    assert.equal(score(specific, site), 5);
    assert.equal(score({ ...specific, company: 'Clinic' }, site), 10);
  });

  test('the score is clamped to 0-100', () => {
    const everything = {
      budgetBand: 'over-40k',
      timeline: 'urgent',
      email: 'a@b.test',
      phone: '300',
      company: 'Clinic',
      need: 'A booking system for my clinic that syncs with Google Calendar',
    };

    assert.equal(score(everything, site), 100);
  });

  test('the tier follows the site thresholds, not hardcoded numbers', () => {
    const strict = makeSite({ hotScoreThreshold: 90, warmScoreThreshold: 80 });

    assert.equal(tierFor(85, site), TIER_HOT);
    assert.equal(tierFor(85, strict), TIER_WARM);
    assert.equal(tierFor(79, strict), TIER_COLD);
  });
});
