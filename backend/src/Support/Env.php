<?php

declare(strict_types=1);

namespace Conserje\Support;

/**
 * Minimal .env loader.
 *
 * Deliberately not a dependency: this reads a handful of keys at boot, and the
 * values it handles are the most sensitive in the project. Existing process
 * environment always wins, so a real deployment can set variables the normal
 * way and leave the file out entirely.
 */
final class Env
{
    public static function load(string $path): void
    {
        if (!is_file($path) || !is_readable($path)) {
            return;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

        foreach ($lines ?: [] as $line) {
            $line = trim($line);

            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            $parts = explode('=', $line, 2);

            if (count($parts) !== 2) {
                continue;
            }

            $key = trim($parts[0]);
            $value = trim($parts[1]);

            if ($key === '' || getenv($key) !== false) {
                continue;
            }

            // Strip one layer of matching quotes, so values with spaces or a
            // trailing '#' survive intact.
            if (strlen($value) >= 2
                && ($value[0] === '"' || $value[0] === "'")
                && $value[strlen($value) - 1] === $value[0]
            ) {
                $value = substr($value, 1, -1);
            }

            putenv("{$key}={$value}");
            $_ENV[$key] = $value;
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $value = getenv($key);

        return is_string($value) && $value !== '' ? $value : $default;
    }

    /** @throws \RuntimeException when the variable is missing or empty. */
    public static function require(string $key): string
    {
        $value = self::get($key);

        if ($value === null) {
            throw new \RuntimeException("Required environment variable '{$key}' is not set.");
        }

        return $value;
    }
}
