/**
 * Drives one turn of the qualification conversation.
 *
 * This is the only place that decides whether a visitor gets to spend a model
 * call, so every limit is enforced here rather than in the transport layer.
 */

import { randomBytes } from 'node:crypto';

import type { SiteConfig } from '../config/site.ts';
import { assistantMessage, Conversation, userMessage } from '../conversation/conversation.ts';
import type { ConversationStore } from '../conversation/store.ts';
import { ChatModelError, type ChatModel } from '../llm/model.ts';
import { charLength, leadFromToolInput, UnusableLeadError, type Lead } from '../qualification/lead.ts';
import { score, tierFor } from '../qualification/scorer.ts';
import type { Clock } from '../support/clock.ts';
import type { LeadDeliverer } from '../webhook/delivery.ts';
import { ChatError, TURN_LIMIT } from './errors.ts';

export interface ChatResult {
  readonly sessionId: string;
  readonly reply: string;
  readonly done: boolean;
  readonly doneReason: string | null;
  readonly lead: Lead | null;
}

/**
 * Response body for the widget.
 *
 * The lead itself is never returned: the visitor supplied it, the widget has
 * no use for it, and echoing a score back to the browser tells anyone watching
 * exactly how to game the routing.
 */
export function toResponseBody(result: ChatResult): Record<string, unknown> {
  return {
    session: result.sessionId,
    reply: result.reply,
    done: result.done,
    reason: result.doneReason,
  };
}

export class ChatService {
  readonly #model: ChatModel;
  readonly #conversations: ConversationStore;
  readonly #delivery: LeadDeliverer;
  readonly #clock: Clock;

  constructor(
    model: ChatModel,
    conversations: ConversationStore,
    delivery: LeadDeliverer,
    clock: Clock,
  ) {
    this.#model = model;
    this.#conversations = conversations;
    this.#delivery = delivery;
    this.#clock = clock;
  }

  async handle(site: SiteConfig, sessionId: string | null, userInput: string): Promise<ChatResult> {
    const text = userInput.trim();

    if (text === '') {
      throw ChatError.emptyMessage();
    }

    if (charLength(text) > site.maxMessageChars) {
      throw ChatError.messageTooLong(site.maxMessageChars);
    }

    const conversation = await this.#resolveConversation(site, sessionId);

    if (conversation.closed) {
      throw ChatError.sessionClosed();
    }

    // Checked before the model call: the cap exists to bound cost, so it has
    // to bite before the money is spent.
    if (conversation.userTurns() >= site.maxTurns) {
      conversation.close(TURN_LIMIT);
      await this.#conversations.save(conversation);

      return {
        sessionId: conversation.id,
        reply: turnLimitReply(site),
        done: true,
        doneReason: TURN_LIMIT,
        lead: null,
      };
    }

    conversation.append(userMessage(text));

    let outcome;

    try {
      outcome = await this.#model.respond(conversation, site);
    } catch (error) {
      // The visitor's message is deliberately not persisted on failure, so a
      // retry replays the same turn instead of duplicating it.
      if (error instanceof ChatModelError) {
        throw ChatError.upstreamUnavailable(error.retryable, error);
      }

      throw ChatError.upstreamUnavailable(true, error);
    }

    conversation.append(assistantMessage(outcome.reply));

    if (outcome.leadInput === null) {
      await this.#conversations.save(conversation);

      return {
        sessionId: conversation.id,
        reply: outcome.reply,
        done: false,
        doneReason: null,
        lead: null,
      };
    }

    const lead = await this.#recordLead(outcome.leadInput, site, conversation);

    conversation.close('lead_recorded');
    await this.#conversations.save(conversation);

    return {
      sessionId: conversation.id,
      reply: outcome.reply,
      done: true,
      doneReason: 'lead_recorded',
      lead,
    };
  }

  /**
   * Score, build and dispatch the lead.
   *
   * A delivery failure must never surface to the visitor: they finished their
   * part correctly. LeadDelivery spools anything it cannot deliver so the lead
   * survives an n8n outage.
   */
  async #recordLead(
    toolInput: Record<string, unknown>,
    site: SiteConfig,
    conversation: Conversation,
  ): Promise<Lead | null> {
    const value = score(toolInput, site);
    const tier = tierFor(value, site);
    let lead: Lead;

    try {
      lead = leadFromToolInput(toolInput, value, tier);
    } catch (error) {
      if (error instanceof UnusableLeadError) {
        // The model called the tool without a usable need. Nothing to route,
        // and nothing the visitor should be told about.
        return null;
      }

      throw error;
    }

    await this.#delivery.deliver(lead, site, conversation, this.#clock.now());

    return lead;
  }

  async #resolveConversation(site: SiteConfig, sessionId: string | null): Promise<Conversation> {
    if (sessionId !== null && sessionId !== '') {
      const existing = await this.#conversations.find(sessionId);

      // A session from another site is treated as absent rather than
      // rejected, so one tenant can never read another's transcript.
      if (existing !== null && existing.siteId === site.id) {
        return existing;
      }
    }

    return Conversation.start(randomBytes(16).toString('hex'), site.id, this.#clock.now());
  }
}

function turnLimitReply(site: SiteConfig): string {
  return site.locale.startsWith('es')
    ? 'Creo que ya tengo bastante para pasarle esto a una persona. Escríbenos y seguimos por ahí.'
    : 'I think I have enough to pass this to a person. Drop us a line and we will pick it up there.';
}
