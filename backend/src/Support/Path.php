<?php

declare(strict_types=1);

namespace Conserje\Support;

/**
 * Resolves a configured path against the application root.
 *
 * Exists because the obvious one-liner is wrong: `ltrim($path, './')` strips
 * every leading dot and slash, so '../sites' silently becomes 'sites' and the
 * app looks for its configuration in the wrong directory.
 */
final class Path
{
    public static function resolve(string $baseDir, string $path): string
    {
        $path = trim($path);

        if ($path === '') {
            return rtrim($baseDir, '/');
        }

        if (str_starts_with($path, '/')) {
            return rtrim($path, '/');
        }

        // Drop a leading './' only -- exactly one, and only that.
        if (str_starts_with($path, './')) {
            $path = substr($path, 2);
        }

        return rtrim(rtrim($baseDir, '/') . '/' . $path, '/');
    }
}
