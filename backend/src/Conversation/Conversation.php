<?php

declare(strict_types=1);

namespace Conserje\Conversation;

/**
 * Server-side conversation state.
 *
 * The browser holds nothing but an opaque session id. Transcript, turn count
 * and completion status all live here, so a visitor cannot rewrite history,
 * replay a finished conversation, or forge a qualified lead by editing a
 * request body.
 */
final class Conversation
{
    /** @param list<Message> $messages */
    private function __construct(
        public readonly string $id,
        public readonly string $siteId,
        public readonly int $createdAt,
        private array $messages,
        private bool $closed,
        private ?string $closedReason,
    ) {
    }

    public static function start(string $id, string $siteId, int $now): self
    {
        return new self($id, $siteId, $now, [], false, null);
    }

    /** @return list<Message> */
    public function messages(): array
    {
        return $this->messages;
    }

    public function append(Message $message): void
    {
        $this->messages[] = $message;
    }

    /** Number of visitor messages so far; this is what the turn cap counts. */
    public function userTurns(): int
    {
        return count(array_filter(
            $this->messages,
            static fn (Message $m): bool => $m->role === Message::ROLE_USER,
        ));
    }

    public function isClosed(): bool
    {
        return $this->closed;
    }

    public function closedReason(): ?string
    {
        return $this->closedReason;
    }

    public function close(string $reason): void
    {
        $this->closed = true;
        $this->closedReason = $reason;
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'siteId' => $this->siteId,
            'createdAt' => $this->createdAt,
            'closed' => $this->closed,
            'closedReason' => $this->closedReason,
            'messages' => array_map(static fn (Message $m): array => $m->toArray(), $this->messages),
        ];
    }

    /** @param array<string,mixed> $raw */
    public static function fromArray(array $raw): self
    {
        $rawMessages = is_array($raw['messages'] ?? null) ? $raw['messages'] : [];
        $messages = [];

        foreach ($rawMessages as $rawMessage) {
            if (is_array($rawMessage)) {
                $messages[] = Message::fromArray($rawMessage);
            }
        }

        return new self(
            id: is_string($raw['id'] ?? null) ? $raw['id'] : '',
            siteId: is_string($raw['siteId'] ?? null) ? $raw['siteId'] : '',
            createdAt: is_int($raw['createdAt'] ?? null) ? $raw['createdAt'] : 0,
            messages: $messages,
            closed: (bool) ($raw['closed'] ?? false),
            closedReason: is_string($raw['closedReason'] ?? null) ? $raw['closedReason'] : null,
        );
    }
}
