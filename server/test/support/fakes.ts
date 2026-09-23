/**
 * Fakes for the ports the service depends on.
 *
 * Every test outside the boot test runs against these: no network, no
 * platform storage, no API key, and a clock that only moves when a test says so.
 */

import type { SiteConfig } from '../../src/config/site.ts';
import { siteFromJson } from '../../src/config/site.ts';
import type { Conversation, ConversationState } from '../../src/conversation/conversation.ts';
import { ChatModelError, ZERO_USAGE, type ChatModel, type TurnOutcome } from '../../src/llm/model.ts';
import type { Lead } from '../../src/qualification/lead.ts';
import type { LeadDeliverer } from '../../src/webhook/delivery.ts';

export function makeSite(overrides: Record<string, unknown> = {}): SiteConfig {
  return siteFromJson({
    id: 'test-site',
    name: 'Test Site',
    locale: 'en',
    allowedOrigins: ['https://example.test'],
    greeting: 'Hello?',
    businessContext: 'A business that does things.',
    collect: ['What they need'],
    budgetBands: ['under-5k', '5k-15k', '15k-40k', 'over-40k'],
    webhookUrlEnv: 'CONSERJE_WEBHOOK_TEST',
    ...overrides,
  });
}

type Script =
  | { kind: 'reply'; text: string }
  | { kind: 'lead'; text: string; input: Record<string, unknown> }
  | { kind: 'fail'; retryable: boolean };

export class FakeChatModel implements ChatModel {
  calls = 0;
  /** The transcript as the model saw it on each call. */
  readonly seen: ConversationState[] = [];

  readonly #script: Script[];

  private constructor(script: Script[]) {
    this.#script = script;
  }

  static replying(...texts: string[]): FakeChatModel {
    return new FakeChatModel(texts.map((text) => ({ kind: 'reply', text })));
  }

  static recordingLead(text: string, input: Record<string, unknown>): FakeChatModel {
    return new FakeChatModel([{ kind: 'lead', text, input }]);
  }

  static failing(retryable: boolean): FakeChatModel {
    return new FakeChatModel([{ kind: 'fail', retryable }]);
  }

  async respond(conversation: Conversation): Promise<TurnOutcome> {
    // Snapshot rather than keep the live object: the service mutates the
    // conversation after this returns, and a test asserting on transcript
    // length would otherwise see the future.
    this.seen.push(structuredClone(conversation.toJSON()));

    const step = this.#script[Math.min(this.calls, this.#script.length - 1)];

    this.calls += 1;

    if (step === undefined) {
      throw new Error('FakeChatModel ran out of script');
    }

    if (step.kind === 'fail') {
      throw new ChatModelError('fake failure', step.retryable);
    }

    return {
      reply: step.text,
      leadInput: step.kind === 'lead' ? step.input : null,
      usage: ZERO_USAGE,
    };
  }
}

export class RecordingDelivery implements LeadDeliverer {
  readonly delivered: Array<{ lead: Lead; siteId: string }> = [];

  readonly #succeeds: boolean;

  constructor(succeeds = true) {
    this.#succeeds = succeeds;
  }

  async deliver(lead: Lead, site: SiteConfig): Promise<boolean> {
    this.delivered.push({ lead, siteId: site.id });

    return this.#succeeds;
  }
}
