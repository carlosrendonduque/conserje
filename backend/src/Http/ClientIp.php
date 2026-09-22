<?php

declare(strict_types=1);

namespace Conserje\Http;

/**
 * Resolves the caller's IP for rate-limiting purposes.
 *
 * X-Forwarded-For is only consulted when the app is explicitly told it sits
 * behind a proxy, because otherwise any client can set that header and give
 * itself an unlimited number of rate-limit buckets.
 */
final class ClientIp
{
    /** @param array<string,mixed> $server */
    public static function resolve(array $server, bool $trustProxy): string
    {
        if ($trustProxy) {
            $forwarded = $server['HTTP_X_FORWARDED_FOR'] ?? null;

            if (is_string($forwarded) && $forwarded !== '') {
                // Leftmost entry is the original client.
                $first = trim(explode(',', $forwarded)[0]);

                if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                    return $first;
                }
            }
        }

        $remote = $server['REMOTE_ADDR'] ?? null;

        return is_string($remote) && $remote !== '' ? $remote : 'unknown';
    }
}
