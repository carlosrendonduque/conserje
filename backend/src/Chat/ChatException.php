<?php

declare(strict_types=1);

namespace Conserje\Chat;

/**
 * A request that cannot be served, carrying the HTTP status and a stable
 * machine-readable code the widget can branch on.
 *
 * The message is written to be safe to show a visitor: no internal paths, no
 * provider errors, nothing about configuration.
 */
final class ChatException extends \RuntimeException
{
    public const RATE_LIMITED = 'rate_limited';
    public const MESSAGE_TOO_LONG = 'message_too_long';
    public const EMPTY_MESSAGE = 'empty_message';
    public const SESSION_CLOSED = 'session_closed';
    public const TURN_LIMIT = 'turn_limit_reached';
    public const UPSTREAM_UNAVAILABLE = 'upstream_unavailable';

    public function __construct(
        public readonly string $errorCode,
        public readonly int $status,
        string $message,
        public readonly bool $retryable = false,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public static function rateLimited(): self
    {
        return new self(
            self::RATE_LIMITED,
            429,
            'Too many messages from here right now. Try again in a few minutes.',
            retryable: true,
        );
    }

    public static function messageTooLong(int $limit): self
    {
        return new self(
            self::MESSAGE_TOO_LONG,
            400,
            "That message is too long. Keep it under {$limit} characters.",
        );
    }

    public static function emptyMessage(): self
    {
        return new self(self::EMPTY_MESSAGE, 400, 'Say something first.');
    }

    public static function sessionClosed(): self
    {
        return new self(self::SESSION_CLOSED, 409, 'This conversation is already finished.');
    }

    public static function upstreamUnavailable(bool $retryable, ?\Throwable $previous = null): self
    {
        return new self(
            self::UPSTREAM_UNAVAILABLE,
            503,
            'The assistant is unavailable right now.',
            $retryable,
            $previous,
        );
    }
}
