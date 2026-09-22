<?php

declare(strict_types=1);

namespace Conserje\Conversation;

/**
 * Persistence for conversation state.
 *
 * Deliberately narrow so the file-backed default can be swapped for Redis or
 * Postgres without touching the service layer.
 */
interface ConversationStore
{
    public function find(string $id): ?Conversation;

    public function save(Conversation $conversation): void;

    /** Drop conversations older than the given age. Returns how many were removed. */
    public function purgeOlderThan(int $seconds): int;
}
