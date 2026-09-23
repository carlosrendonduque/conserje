import type { SiteConfig } from '../config/site.ts';
import type { Conversation } from '../conversation/conversation.ts';

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export interface TurnOutcome {
  readonly reply: string;
  /** Raw tool input when the model recorded a lead this turn, else null. */
  readonly leadInput: Record<string, unknown> | null;
  readonly usage: Usage;
}

export interface ChatModel {
  respond(conversation: Conversation, site: SiteConfig): Promise<TurnOutcome>;
}

export class ChatModelError extends Error {
  override readonly name = 'ChatModelError';

  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.retryable = retryable;
  }
}
