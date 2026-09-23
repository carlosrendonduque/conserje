/**
 * Server-side conversation state.
 *
 * The browser holds nothing but an opaque session id. Transcript, turn count
 * and completion status all live here, so a visitor cannot rewrite history,
 * replay a finished conversation, or forge a qualified lead by editing a
 * request body.
 */

export type Role = 'user' | 'assistant';

export interface Message {
  readonly role: Role;
  readonly text: string;
}

export function userMessage(text: string): Message {
  return { role: 'user', text };
}

export function assistantMessage(text: string): Message {
  return { role: 'assistant', text };
}

export interface ConversationState {
  readonly id: string;
  readonly siteId: string;
  readonly createdAt: number;
  readonly messages: readonly Message[];
  readonly closed: boolean;
  readonly closedReason: string | null;
}

export class Conversation {
  #messages: Message[];
  #closed: boolean;
  #closedReason: string | null;

  readonly id: string;
  readonly siteId: string;
  readonly createdAt: number;

  private constructor(
    id: string,
    siteId: string,
    createdAt: number,
    messages: Message[],
    closed: boolean,
    closedReason: string | null,
  ) {
    this.id = id;
    this.siteId = siteId;
    this.createdAt = createdAt;
    this.#messages = messages;
    this.#closed = closed;
    this.#closedReason = closedReason;
  }

  static start(id: string, siteId: string, now: number): Conversation {
    return new Conversation(id, siteId, now, [], false, null);
  }

  get messages(): readonly Message[] {
    return this.#messages;
  }

  append(message: Message): void {
    this.#messages.push(message);
  }

  /** Number of visitor messages so far; this is what the turn cap counts. */
  userTurns(): number {
    return this.#messages.filter((m) => m.role === 'user').length;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get closedReason(): string | null {
    return this.#closedReason;
  }

  close(reason: string): void {
    this.#closed = true;
    this.#closedReason = reason;
  }

  toJSON(): ConversationState {
    return {
      id: this.id,
      siteId: this.siteId,
      createdAt: this.createdAt,
      messages: [...this.#messages],
      closed: this.#closed,
      closedReason: this.#closedReason,
    };
  }

  /** Tolerant by design: stored state predates any field added later. */
  static fromJSON(raw: unknown): Conversation {
    const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const rawMessages = Array.isArray(record['messages']) ? record['messages'] : [];

    const messages: Message[] = [];

    for (const entry of rawMessages) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }

      const message = entry as Record<string, unknown>;
      const text = typeof message['text'] === 'string' ? message['text'] : '';

      messages.push({ role: message['role'] === 'assistant' ? 'assistant' : 'user', text });
    }

    return new Conversation(
      typeof record['id'] === 'string' ? record['id'] : '',
      typeof record['siteId'] === 'string' ? record['siteId'] : '',
      typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
      messages,
      record['closed'] === true,
      typeof record['closedReason'] === 'string' ? record['closedReason'] : null,
    );
  }
}
