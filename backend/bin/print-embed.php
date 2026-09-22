#!/usr/bin/env php
<?php

/**
 * Print the embed snippet for a site.
 *
 * The greeting, title and locale all come from the site config, so the snippet
 * and the backend can never disagree about them. Paste the output into the
 * host page.
 *
 *   php bin/print-embed.php carlos-portfolio
 *   php bin/print-embed.php carlos-portfolio --endpoint=https://api.example.com/chat
 */

declare(strict_types=1);

use Conserje\Config\ConfigException;
use Conserje\Config\SiteRepository;
use Conserje\Support\Env;
use Conserje\Support\Path;

$baseDir = dirname(__DIR__);

require $baseDir . '/vendor/autoload.php';

Env::load($baseDir . '/.env');

$siteId = $argv[1] ?? null;

if ($siteId === null || str_starts_with($siteId, '--')) {
    fwrite(STDERR, "Usage: php bin/print-embed.php <site-id> [--endpoint=URL] [--script=URL]\n");

    exit(1);
}

$endpoint = 'https://api.example.com/chat';
$scriptUrl = 'https://cdn.example.com/conserje.js';

foreach ($argv as $arg) {
    if (str_starts_with($arg, '--endpoint=')) {
        $endpoint = substr($arg, 11);
    }

    if (str_starts_with($arg, '--script=')) {
        $scriptUrl = substr($arg, 9);
    }
}

$sitesDir = Env::get('CONSERJE_SITES_DIR', '../sites') ?? '../sites';
$sitesDir = Path::resolve($baseDir, $sitesDir);

try {
    $site = (new SiteRepository($sitesDir))->get($siteId);
} catch (ConfigException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");

    exit(1);
}

$attr = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');

echo <<<HTML
    <script src="{$attr($scriptUrl)}"
            data-endpoint="{$attr($endpoint)}"
            data-site="{$attr($site->id)}"
            data-title="{$attr($site->name)}"
            data-greeting="{$attr($site->greeting)}"
            data-locale="{$attr($site->locale)}"
            defer></script>

    HTML;

echo "\n";
echo "Allowed origins for this site:\n";

foreach ($site->allowedOrigins as $origin) {
    echo "  {$origin}\n";
}

echo "\nThe page must be served from one of those, or the browser will block the call.\n";
