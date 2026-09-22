<?php

declare(strict_types=1);

namespace Conserje\Conversation;

/** One turn in the transcript. Roles mirror the Messages API. */
final class Message
{
    public const ROLE_USER = 'user';
    public const ROLE_ASSISTANT = 'assistant';

    public function __construct(
        public readonly string $role,
        public readonly string $text,
    ) {
    }

    public static function user(string $text): self
    {
        return new self(self::ROLE_USER, $text);
    }

    public static function assistant(string $text): self
    {
        return new self(self::ROLE_ASSISTANT, $text);
    }

    /** @return array{role:string,text:string} */
    public function toArray(): array
    {
        return ['role' => $this->role, 'text' => $this->text];
    }

    /** @param array{role?:mixed,text?:mixed} $raw */
    public static function fromArray(array $raw): self
    {
        $role = is_string($raw['role'] ?? null) ? $raw['role'] : self::ROLE_USER;
        $text = is_string($raw['text'] ?? null) ? $raw['text'] : '';

        return new self($role === self::ROLE_ASSISTANT ? self::ROLE_ASSISTANT : self::ROLE_USER, $text);
    }
}
