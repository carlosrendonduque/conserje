import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { allowsOrigin, ConfigError, siteFromJson } from '../src/config/site.ts';
import { makeSite } from './support/fakes.ts';

const valid = {
  id: 'acme',
  name: 'Acme',
  allowedOrigins: ['https://acme.test'],
  greeting: 'Hi?',
  businessContext: 'Acme does things.',
  collect: ['What they need'],
  budgetBands: ['small', 'large'],
  webhookUrlEnv: 'CONSERJE_WEBHOOK_ACME',
};

describe('SiteConfig', () => {
  test('it applies defaults for everything optional', () => {
    const site = siteFromJson(valid);

    assert.equal(site.locale, 'en');
    assert.equal(site.model, 'claude-opus-5');
    assert.equal(site.maxTurns, 14);
    assert.equal(site.maxMessageChars, 1200);
    assert.equal(site.requestsPerHour, 60);
    assert.equal(site.hotScoreThreshold, 70);
    assert.equal(site.warmScoreThreshold, 40);
  });

  test('a missing required field is rejected at load, not at request time', () => {
    for (const key of ['id', 'name', 'greeting', 'businessContext', 'webhookUrlEnv']) {
      const broken = { ...valid, [key]: '' };

      assert.throws(() => siteFromJson(broken), ConfigError, `'${key}' should be required`);
    }
  });

  test('a site id that could escape a path or a key is rejected', () => {
    for (const id of ['../etc', 'Acme', 'a b', '', 'a/b']) {
      assert.throws(() => siteFromJson({ ...valid, id }), ConfigError);
    }
  });

  test('a site must declare at least one origin and one budget band', () => {
    assert.throws(() => siteFromJson({ ...valid, allowedOrigins: [] }), ConfigError);
    assert.throws(() => siteFromJson({ ...valid, budgetBands: [] }), ConfigError);
  });

  test('a malformed origin is rejected', () => {
    assert.throws(() => siteFromJson({ ...valid, allowedOrigins: ['acme.test'] }), ConfigError);
    assert.throws(() => siteFromJson({ ...valid, allowedOrigins: ['not a url'] }), ConfigError);
  });

  test('an origin with a trailing slash is rejected', () => {
    // Browsers never send one, so the entry would be silently unmatchable and
    // the allowlist quietly shorter than it looks.
    assert.throws(() => siteFromJson({ ...valid, allowedOrigins: ['https://acme.test/'] }), ConfigError);
  });

  test('the warm threshold must sit below the hot threshold', () => {
    assert.throws(
      () => siteFromJson({ ...valid, hotScoreThreshold: 40, warmScoreThreshold: 70 }),
      ConfigError,
    );
  });

  test('the origin allowlist matches exactly, never by suffix', () => {
    // Wildcards and suffix matching are how allowlists quietly stop being
    // allowlists: evil-acme.test must not pass because it ends in acme.test.
    const site = makeSite({ allowedOrigins: ['https://acme.test'] });

    assert.equal(allowsOrigin(site, 'https://acme.test'), true);
    assert.equal(allowsOrigin(site, 'https://evil-acme.test'), false);
    assert.equal(allowsOrigin(site, 'http://acme.test'), false);
    assert.equal(allowsOrigin(site, 'https://acme.test:8443'), false);
    assert.equal(allowsOrigin(site, null), false);
  });
});
