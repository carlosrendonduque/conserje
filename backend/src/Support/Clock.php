<?php

declare(strict_types=1);

namespace Conserje\Support;

/** Indirection over time so expiry and rate-limit windows are testable. */
interface Clock
{
    public function now(): int;
}
