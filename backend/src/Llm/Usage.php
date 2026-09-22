<?php

declare(strict_types=1);

namespace Conserje\Llm;

/**
 * Token accounting for one turn.
 *
 * Surfaced so the cache-hit rate is observable: if cacheReadInputTokens stays
 * at zero across consecutive visitors on the same site, the stable prefix has
 * been broken and every conversation is paying full price for the prompt.
 */
final class Usage
{
    public function __construct(
        public readonly int $inputTokens = 0,
        public readonly int $outputTokens = 0,
        public readonly int $cacheCreationInputTokens = 0,
        public readonly int $cacheReadInputTokens = 0,
    ) {
    }

    public function plus(self $other): self
    {
        return new self(
            $this->inputTokens + $other->inputTokens,
            $this->outputTokens + $other->outputTokens,
            $this->cacheCreationInputTokens + $other->cacheCreationInputTokens,
            $this->cacheReadInputTokens + $other->cacheReadInputTokens,
        );
    }

    /** @return array<string,int> */
    public function toArray(): array
    {
        return [
            'inputTokens' => $this->inputTokens,
            'outputTokens' => $this->outputTokens,
            'cacheCreationInputTokens' => $this->cacheCreationInputTokens,
            'cacheReadInputTokens' => $this->cacheReadInputTokens,
        ];
    }
}
