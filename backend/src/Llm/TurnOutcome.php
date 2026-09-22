<?php

declare(strict_types=1);

namespace Conserje\Llm;

/**
 * The result of one model turn.
 *
 * `leadInput` is non-null exactly when the model decided the conversation had
 * produced a lead, which is also the signal to close the session.
 */
final class TurnOutcome
{
    /** @param array<string,mixed>|null $leadInput */
    public function __construct(
        public readonly string $reply,
        public readonly ?array $leadInput,
        public readonly Usage $usage,
    ) {
    }

    public function producedLead(): bool
    {
        return $this->leadInput !== null;
    }
}
