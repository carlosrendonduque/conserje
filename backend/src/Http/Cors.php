<?php

declare(strict_types=1);

namespace Conserje\Http;

use Conserje\Config\SiteConfig;

/**
 * Per-site CORS.
 *
 * The widget runs on the client's page, so the browser sends an Origin on
 * every call. Each site declares exactly which origins may embed it, and the
 * reflected value is always one from that list -- never the request's own
 * Origin echoed back, which would make the allowlist decorative.
 */
final class Cors
{
    public static function apply(SiteConfig $site, ?string $origin): bool
    {
        if (!$site->allowsOrigin($origin)) {
            return false;
        }

        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Max-Age: 600');

        return true;
    }

    public static function preflight(): void
    {
        http_response_code(204);
        header('Content-Length: 0');
    }
}
