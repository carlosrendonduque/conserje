#!/usr/bin/env php
<?php

/**
 * Replay leads that could not be delivered to n8n.
 *
 * Run it after an outage, or on a cron every few minutes as a safety net:
 *
 *   php bin/retry-spool.php
 *   php bin/retry-spool.php --dry-run
 *
 * Successfully delivered records are deleted from the spool. Anything that
 * fails again is left in place for the next run.
 */

declare(strict_types=1);

use Conserje\Config\SiteRepository;
use Conserje\Support\Env;
use Conserje\Webhook\WebhookDispatcher;
use Conserje\Webhook\WebhookException;

$baseDir = dirname(__DIR__);

require $baseDir . '/vendor/autoload.php';

Env::load($baseDir . '/.env');

$dryRun = in_array('--dry-run', $argv, true);
$stateDir = Env::get('CONSERJE_STATE_DIR', './var') ?? './var';
$stateDir = str_starts_with($stateDir, '/') ? $stateDir : $baseDir . '/' . ltrim($stateDir, './');
$spoolDir = rtrim($stateDir, '/') . '/spool';

$sitesDir = Env::get('CONSERJE_SITES_DIR', '../sites') ?? '../sites';
$sitesDir = str_starts_with($sitesDir, '/') ? $sitesDir : $baseDir . '/' . ltrim($sitesDir, './');

$files = glob($spoolDir . '/*.json') ?: [];

if ($files === []) {
    echo "Spool is empty.\n";

    exit(0);
}

$sites = new SiteRepository($sitesDir);
$dispatcher = new WebhookDispatcher(Env::get('CONSERJE_WEBHOOK_SECRET', '') ?? '');

$delivered = 0;
$failed = 0;

foreach ($files as $file) {
    $contents = file_get_contents($file);

    if ($contents === false) {
        fwrite(STDERR, "Could not read {$file}\n");
        ++$failed;

        continue;
    }

    try {
        /** @var array<string,mixed> $record */
        $record = json_decode($contents, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        fwrite(STDERR, "Corrupt spool file {$file}: {$e->getMessage()}\n");
        ++$failed;

        continue;
    }

    $siteId = is_string($record['siteId'] ?? null) ? $record['siteId'] : '';
    $payload = is_array($record['payload'] ?? null) ? $record['payload'] : null;

    if ($payload === null || !$sites->has($siteId)) {
        fwrite(STDERR, "Skipping {$file}: unusable record.\n");
        ++$failed;

        continue;
    }

    $url = getenv($sites->get($siteId)->webhookUrlEnv);

    if (!is_string($url) || trim($url) === '') {
        fwrite(STDERR, "Skipping {$file}: no webhook URL configured for '{$siteId}'.\n");
        ++$failed;

        continue;
    }

    if ($dryRun) {
        echo "Would deliver " . basename($file) . " to {$siteId}\n";

        continue;
    }

    try {
        // Re-sign with the current time; the original timestamp would be
        // outside the replay tolerance the workflow enforces.
        $dispatcher->send($url, $payload, time());
        unlink($file);
        ++$delivered;
        echo "Delivered " . basename($file) . "\n";
    } catch (WebhookException $e) {
        fwrite(STDERR, "Still failing for " . basename($file) . ": {$e->getMessage()}\n");
        ++$failed;
    }
}

echo "\nDelivered: {$delivered}  Failed: {$failed}\n";

exit($failed > 0 ? 1 : 0);
