<?php

declare(strict_types=1);

namespace Conserje\Config;

/**
 * Immutable configuration for one host site.
 *
 * A "site" is a tenant: one landing page, one client, one set of qualification
 * rules. Everything that differs between deployments lives here so that adding
 * a client is a JSON file, not a code change.
 */
final class SiteConfig
{
    /**
     * @param list<string> $allowedOrigins Exact origins allowed to embed the widget.
     * @param list<string> $collect        Facts the assistant must gather before closing.
     * @param list<string> $budgetBands    Ordered low-to-high; the index feeds lead scoring.
     */
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly string $locale,
        public readonly string $model,
        public readonly array $allowedOrigins,
        public readonly string $greeting,
        public readonly string $businessContext,
        public readonly array $collect,
        public readonly array $budgetBands,
        public readonly int $maxTurns,
        public readonly int $maxMessageChars,
        public readonly int $requestsPerHour,
        public readonly string $webhookUrlEnv,
        public readonly int $hotScoreThreshold,
        public readonly int $warmScoreThreshold,
    ) {
    }

    /**
     * Build from a decoded JSON config, applying defaults and rejecting
     * anything malformed. Fail loudly here rather than at request time.
     *
     * @param array<string,mixed> $raw
     *
     * @throws ConfigException
     */
    public static function fromArray(array $raw): self
    {
        $id = self::requireString($raw, 'id');

        if (preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $id) !== 1) {
            throw new ConfigException("Site id '{$id}' must be lowercase alphanumeric with dashes.");
        }

        $origins = self::requireList($raw, 'allowedOrigins', $id);

        if ($origins === []) {
            throw new ConfigException("Site '{$id}' must declare at least one allowed origin.");
        }

        foreach ($origins as $origin) {
            if (parse_url($origin, PHP_URL_SCHEME) === null || parse_url($origin, PHP_URL_HOST) === null) {
                throw new ConfigException("Site '{$id}' has a malformed origin: '{$origin}'.");
            }

            if (rtrim($origin, '/') !== $origin) {
                throw new ConfigException("Origin '{$origin}' must not end in a slash; browsers never send one.");
            }
        }

        $budgetBands = self::requireList($raw, 'budgetBands', $id);

        if ($budgetBands === []) {
            throw new ConfigException("Site '{$id}' must declare at least one budget band.");
        }

        $hot = self::intOr($raw, 'hotScoreThreshold', 70);
        $warm = self::intOr($raw, 'warmScoreThreshold', 40);

        if ($warm >= $hot) {
            throw new ConfigException("Site '{$id}': warmScoreThreshold must be below hotScoreThreshold.");
        }

        return new self(
            id: $id,
            name: self::requireString($raw, 'name'),
            locale: self::stringOr($raw, 'locale', 'en'),
            // Defaults to the current flagship. Override per site to trade
            // quality for cost -- see docs/ARCHITECTURE.md.
            model: self::stringOr($raw, 'model', 'claude-opus-5'),
            allowedOrigins: $origins,
            greeting: self::requireString($raw, 'greeting'),
            businessContext: self::requireString($raw, 'businessContext'),
            collect: self::requireList($raw, 'collect', $id),
            budgetBands: $budgetBands,
            maxTurns: self::intOr($raw, 'maxTurns', 14),
            maxMessageChars: self::intOr($raw, 'maxMessageChars', 1200),
            requestsPerHour: self::intOr($raw, 'requestsPerHour', 60),
            webhookUrlEnv: self::requireString($raw, 'webhookUrlEnv'),
            hotScoreThreshold: $hot,
            warmScoreThreshold: $warm,
        );
    }

    public function allowsOrigin(?string $origin): bool
    {
        // Exact match only. Wildcards and suffix matching are how allowlists
        // quietly stop being allowlists.
        return $origin !== null && in_array($origin, $this->allowedOrigins, true);
    }

    /**
     * @param array<string,mixed> $raw
     *
     * @throws ConfigException
     */
    private static function requireString(array $raw, string $key): string
    {
        $value = $raw[$key] ?? null;

        if (!is_string($value) || trim($value) === '') {
            throw new ConfigException("Missing or empty required string '{$key}'.");
        }

        return $value;
    }

    /**
     * @param array<string,mixed> $raw
     *
     * @return list<string>
     *
     * @throws ConfigException
     */
    private static function requireList(array $raw, string $key, string $siteId): array
    {
        $value = $raw[$key] ?? null;

        if (!is_array($value)) {
            throw new ConfigException("Site '{$siteId}': '{$key}' must be an array of strings.");
        }

        $out = [];

        foreach ($value as $item) {
            if (!is_string($item) || trim($item) === '') {
                throw new ConfigException("Site '{$siteId}': '{$key}' must contain non-empty strings only.");
            }

            $out[] = $item;
        }

        return $out;
    }

    /** @param array<string,mixed> $raw */
    private static function stringOr(array $raw, string $key, string $default): string
    {
        $value = $raw[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? $value : $default;
    }

    /** @param array<string,mixed> $raw */
    private static function intOr(array $raw, string $key, int $default): int
    {
        $value = $raw[$key] ?? null;

        return is_int($value) && $value > 0 ? $value : $default;
    }
}
