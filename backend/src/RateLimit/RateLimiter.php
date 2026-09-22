<?php

declare(strict_types=1);

namespace Conserje\RateLimit;

interface RateLimiter
{
    /**
     * Record a hit against the key and report whether it is within the limit.
     * Returns false once the caller has exceeded `$limit` hits in `$windowSeconds`.
     */
    public function allow(string $key, int $limit, int $windowSeconds): bool;
}
