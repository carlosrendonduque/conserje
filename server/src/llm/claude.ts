/**
 * Claude-backed implementation of the qualification turn.
 *
 * Three things are worth knowing about the request shape:
 *
 * 1. The system prompt and tool definition are rendered from site config only,
 *    and the cache breakpoint sits on the last system block. Tools and system
 *    render ahead of messages, so that prefix is byte-identical for every
 *    visitor on a site and consecutive conversations read it from cache.
 *
 * 2. Effort is pinned low. Qualification is a short, latency-sensitive
 *    exchange where the visitor is watching a typing indicator; thinking stays
 *    on (disabling it on this model tier causes tool calls to leak into
 *    visible text) but is kept shallow.
 *
 * 3. Failures are logged before they are wrapped. The visitor gets a generic
 *    message either way, but an operator reading the function log needs to be
 *    able to tell a bad schema from an expired key from a retired model -- all
 *    three look identical from outside.
 */

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type {
  Message as ApiMessage,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';

import type { SiteConfig } from '../config/site.ts';
import type { Conversation } from '../conversation/conversation.ts';
import { leadTool, systemPrompt, TOOL_NAME } from '../qualification/prompt.ts';
import { addUsage, ChatModelError, type ChatModel, type TurnOutcome, type Usage } from './model.ts';

const MAX_TOKENS = 1024;

/** Error types the caller may as well try again on. */
const RETRYABLE_TYPES = new Set(['rate_limit_error', 'overloaded_error', 'api_error']);

export class ClaudeChatModel implements ChatModel {
  readonly #client: Anthropic;
  readonly #log: (message: string) => void;

  constructor(client: Anthropic, log: (message: string) => void = console.error) {
    this.#client = client;
    this.#log = log;
  }

  async respond(conversation: Conversation, site: SiteConfig): Promise<TurnOutcome> {
    const system: TextBlockParam[] = [
      {
        type: 'text',
        text: systemPrompt(site),
        cache_control: { type: 'ephemeral' },
      },
    ];

    const tools = [leadTool(site)];
    const messages = toApiMessages(conversation);

    const response = await this.#call(site, system, tools, messages);
    const usage = usageOf(response);
    const toolUse = findLeadToolUse(response);

    if (toolUse === null) {
      return { reply: textOf(response), leadInput: null, usage };
    }

    // The model recorded a lead. Close the tool loop so the sign-off is
    // written by the model rather than stitched together from a template.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: 'Recorded. A human will pick this up.',
        },
      ],
    });

    const closing = await this.#call(site, system, tools, messages);

    return {
      reply: textOf(closing) || textOf(response),
      leadInput: (toolUse.input ?? {}) as Record<string, unknown>,
      usage: addUsage(usage, usageOf(closing)),
    };
  }

  async #call(
    site: SiteConfig,
    system: TextBlockParam[],
    tools: Tool[],
    messages: MessageParam[],
  ): Promise<ApiMessage> {
    try {
      return await this.#client.messages.create({
        model: site.model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'low' },
        system,
        tools,
        messages,
      });
    } catch (cause) {
      if (cause instanceof APIError) {
        const type = errorTypeOf(cause);

        // The detail never reaches the visitor, so it has to reach the log --
        // otherwise every upstream fault is an indistinguishable 503.
        this.#log(`[conserje] model request failed (${cause.status} ${type}): ${cause.message}`);

        throw new ChatModelError(`Model request failed (${type}).`, RETRYABLE_TYPES.has(type), { cause });
      }

      this.#log(`[conserje] model transport failed: ${String(cause)}`);

      // Transport-level failures are worth one retry from the widget.
      throw new ChatModelError('Model request failed.', true, { cause });
    }
  }
}

function errorTypeOf(error: APIError): string {
  const body = error.error as { error?: { type?: unknown } } | undefined;
  const type = body?.error?.type;

  return typeof type === 'string' ? type : 'unknown';
}

function toApiMessages(conversation: Conversation): MessageParam[] {
  return conversation.messages.map((message) => ({
    role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: message.text,
  }));
}

function findLeadToolUse(response: ApiMessage): ToolUseBlock | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === TOOL_NAME) {
      return block;
    }
  }

  return null;
}

/** Concatenate text blocks, skipping thinking and tool-use blocks. */
function textOf(response: ApiMessage): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

function usageOf(response: ApiMessage): Usage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
  };
}
