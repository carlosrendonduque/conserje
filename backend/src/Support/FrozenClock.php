<?php

declare(strict_types=1);

namespace Conserje\Support;

/** Test double; also handy for replaying a transcript at a fixed instant. */
final class FrozenClock implements Clock
{
    public function __construct(private int $timestamp)
    {
    }

    public function now(): int
    {
        return $this->timestamp;
    }

    public function advance(int $seconds): void
    {
        $this->timestamp += $seconds;
    }
}
