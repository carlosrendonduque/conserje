import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { leadTool, systemPrompt, TOOL_NAME } from '../src/qualification/prompt.ts';
import { makeSite } from './support/fakes.ts';

/** The tool's schema, narrowed for assertions. */
const schemaOf = (site = makeSite()) =>
  leadTool(site).input_schema as unknown as {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, Record<string, unknown>>;
  };

describe('PromptBuilder', () => {
  test('the prompt carries the business context verbatim', () => {
    const site = makeSite({ businessContext: 'We only fit crowns. No orthodontics.' });

    assert.ok(systemPrompt(site).includes('We only fit crowns. No orthodontics.'));
  });

  test('what to collect and the budget bands are rendered as lists', () => {
    const site = makeSite({ collect: ['Their name', 'Their deadline'] });
    const prompt = systemPrompt(site);

    assert.ok(prompt.includes('- Their name'));
    assert.ok(prompt.includes('- Their deadline'));
    assert.ok(prompt.includes('- under-5k'));
  });

  test('the prompt names the tool it tells the model to call', () => {
    // A rename that updated only one of the two would leave the model calling
    // a tool that does not exist.
    assert.ok(systemPrompt(makeSite()).includes(`\`${TOOL_NAME}\``));
    assert.equal(leadTool(makeSite()).name, TOOL_NAME);
  });

  test('the prompt is built from config only, so the cached prefix is stable', () => {
    // Anything per-request in here would change the prefix on every visitor
    // and silently turn every cache read into a cache write.
    const site = makeSite();

    assert.equal(systemPrompt(site), systemPrompt(site));
    assert.deepEqual(leadTool(site), leadTool(site));
  });

  test('strict mode is on and the schema is closed', () => {
    const schema = schemaOf();

    assert.equal(leadTool(makeSite()).strict, true);
    assert.equal(schema.additionalProperties, false);
  });

  test('strict mode requires every property to be listed as required', () => {
    const schema = schemaOf();

    assert.deepEqual(
      Object.keys(schema.properties).sort(),
      [...schema.required].sort(),
      'strict mode rejects a schema whose required list omits a property',
    );
  });

  test('the budget band is an anyOf so strict mode accepts it', () => {
    // Not a nullable `type` carrying an `enum`: under `strict` the API rejects
    // that with "Enum value '...' does not match declared type", and the
    // failure only shows up as a 400 on a live request.
    const budgetBand = schemaOf(makeSite({ budgetBands: ['a', 'b'] })).properties['budgetBand']!;

    assert.equal('type' in budgetBand, false);
    assert.equal('enum' in budgetBand, false);
    assert.deepEqual(budgetBand['anyOf'], [{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }]);
  });

  test('only the need and summary are non-nullable', () => {
    const properties = schemaOf().properties;

    assert.equal(properties['need']!['type'], 'string');
    assert.equal(properties['summary']!['type'], 'string');
    assert.deepEqual(properties['email']!['type'], ['string', 'null']);
    assert.deepEqual(properties['name']!['type'], ['string', 'null']);
  });

  test('the prompt tells the model to treat visitor text as data', () => {
    const prompt = systemPrompt(makeSite());

    assert.ok(prompt.includes('never instruction to'));
  });
});
