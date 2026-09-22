#!/usr/bin/env php
<?php

/**
 * Delete conversation transcripts older than the retention window.
 *
 * Transcripts contain whatever visitors typed, so they are not kept
 * indefinitely. Run daily:
 *
 *   php bin/purge-conversations.php
 *   php bin/purge-conversations.php --days=7
 */

declare(strict_types=1);

use Conserje\App;
use Conserje\Conversation\FileConversationStore;
use Conserje\Support\Env;
use Conserje\Support\Path;
use Conserje\Support\SystemClock;

$baseDir = dirname(__DIR__);

require $baseDir . '/vendor/autoload.php';

Env::load($baseDir . '/.env');

$days = 1;

foreach ($argv as $arg) {
    if (preg_match('/^--days=(\d+)$/', $arg, $matches) === 1) {
        $days = max(1, (int) $matches[1]);
    }
}

$stateDir = Env::get('CONSERJE_STATE_DIR', './var') ?? './var';
$stateDir = Path::resolve($baseDir, $stateDir);

$store = new FileConversationStore($stateDir . '/conversations', new SystemClock());
$removed = $store->purgeOlderThan($days * 86400);

echo "Removed {$removed} conversation(s) older than {$days} day(s).\n";
