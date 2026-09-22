<?php

declare(strict_types=1);

namespace Conserje\RateLimit;

use Conserje\Support\Clock;

/**
 * Sliding-window rate limiter backed by one small file per key.
 *
 * A model call costs real money, so this is the difference between a widget
 * and an open wallet. The window is exact rather than a fixed bucket: a fixed
 * bucket lets someone spend the whole allowance twice across a boundary.
 *
 * The file is opened once and held under an exclusive lock for read, prune and
 * write, so two concurrent requests cannot both read a stale count and both
 * decide they are under the limit.
 */
final class FileRateLimiter implements RateLimiter
{
    public function __construct(
        private readonly string $directory,
        private readonly Clock $clock,
    ) {
    }

    public function allow(string $key, int $limit, int $windowSeconds): bool
    {
        if ($limit <= 0) {
            return false;
        }

        $this->ensureDirectory();

        $path = rtrim($this->directory, '/') . '/' . hash('sha256', $key) . '.window';
        $handle = fopen($path, 'c+');

        if ($handle === false) {
            // Fail closed: if the limiter cannot do its job, the request does
            // not get a free pass to the paid API.
            return false;
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                return false;
            }

            $now = $this->clock->now();
            $contents = stream_get_contents($handle);
            $hits = $this->parse($contents === false ? '' : $contents, $now - $windowSeconds);

            if (count($hits) >= $limit) {
                return false;
            }

            $hits[] = $now;

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, implode(',', $hits));
            fflush($handle);

            return true;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /** @return list<int> timestamps still inside the window, oldest first */
    private function parse(string $contents, int $cutoff): array
    {
        $hits = [];

        foreach (explode(',', trim($contents)) as $token) {
            if ($token === '' || !ctype_digit($token)) {
                continue;
            }

            $timestamp = (int) $token;

            if ($timestamp > $cutoff) {
                $hits[] = $timestamp;
            }
        }

        sort($hits);

        return $hits;
    }

    private function ensureDirectory(): void
    {
        if (!is_dir($this->directory) && !mkdir($this->directory, 0770, true) && !is_dir($this->directory)) {
            throw new \RuntimeException("Could not create rate-limit directory '{$this->directory}'.");
        }
    }
}
