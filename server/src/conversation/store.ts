/**
 * Persistence for conversation state.
 *
 * Deliberately narrow so the Blobs-backed default can be swapped for Redis or
 * Postgres without touching the service layer -- and so tests can run against
 * memory without a network.
 *
 * Expiry is a stored field rather than a platform TTL: Netlify Blobs has no
 * per-key expiry, and a transcript that outlives its window is a privacy
 * problem, not just wasted space. Reads treat an expired record as absent, and
 * `purgeExpired` reclaims the storage.
 */

import { lazyStore, type LazyStore } from '../support/lazy-store.ts';

import type { Clock } from '../support/clock.ts';
import { Conversation, type ConversationState } from './conversation.ts';

export interface ConversationStore {
  find(id: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
  /** Drop conversations older than the given age. Returns how many were removed. */
  purgeOlderThan(seconds: number): Promise<number>;
}

export const CONVERSATION_TTL_SECONDS = 86_400;

/** Session ids are hex from randomBytes, but never trust one into a path. */
const ID_PATTERN = /^[a-f0-9]{32}$/;

export class BlobConversationStore implements ConversationStore {
  readonly #store: LazyStore;
  readonly #clock: Clock;

  constructor(clock: Clock, store: LazyStore = lazyStore('conserje-conversations')) {
    this.#store = store;
    this.#clock = clock;
  }

  async find(id: string): Promise<Conversation | null> {
    if (!ID_PATTERN.test(id)) {
      return null;
    }

    const raw = await this.#store().get(id, { type: 'json' });

    if (raw === null || typeof raw !== 'object') {
      return null;
    }

    const state = raw as ConversationState;

    if (this.#clock.now() - state.createdAt > CONVERSATION_TTL_SECONDS) {
      return null;
    }

    return Conversation.fromJSON(state);
  }

  async save(conversation: Conversation): Promise<void> {
    await this.#store().setJSON(conversation.id, conversation.toJSON());
  }

  async purgeOlderThan(seconds: number): Promise<number> {
    const cutoff = this.#clock.now() - seconds;
    const { blobs } = await this.#store().list();
    let removed = 0;

    for (const blob of blobs) {
      const raw = await this.#store().get(blob.key, { type: 'json' });

      if (raw === null || typeof raw !== 'object') {
        continue;
      }

      const createdAt = (raw as ConversationState).createdAt;

      if (typeof createdAt === 'number' && createdAt < cutoff) {
        await this.#store().delete(blob.key);
        removed += 1;
      }
    }

    return removed;
  }
}

/** For tests, and for `netlify dev` runs that should not touch real storage. */
export class MemoryConversationStore implements ConversationStore {
  readonly #records = new Map<string, ConversationState>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async find(id: string): Promise<Conversation | null> {
    const state = this.#records.get(id);

    if (state === undefined || this.#clock.now() - state.createdAt > CONVERSATION_TTL_SECONDS) {
      return null;
    }

    return Conversation.fromJSON(structuredClone(state));
  }

  async save(conversation: Conversation): Promise<void> {
    this.#records.set(conversation.id, structuredClone(conversation.toJSON()));
  }

  async purgeOlderThan(seconds: number): Promise<number> {
    const cutoff = this.#clock.now() - seconds;
    let removed = 0;

    for (const [id, state] of this.#records) {
      if (state.createdAt < cutoff) {
        this.#records.delete(id);
        removed += 1;
      }
    }

    return removed;
  }
}
