<?php

declare(strict_types=1);

namespace Conserje\Llm;

/**
 * Wraps any provider-side failure.
 *
 * `retryable` distinguishes "come back in a moment" (rate limits, overload,
 * transport errors) from "this request will never work", which is what the
 * widget needs in order to decide whether to offer a retry.
 */
final class ChatModelException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly bool $retryable = false,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}
