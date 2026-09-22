<?php

/**
 * Prints the signature the PHP backend would send, so the n8n contract test
 * can check the Code node against the real implementation rather than against
 * a second copy of the same assumption.
 *
 * Usage: php php-sign.php <body> <timestamp> <secret>
 */

declare(strict_types=1);

require __DIR__ . '/../../backend/vendor/autoload.php';

if ($argc !== 4) {
    fwrite(STDERR, "Usage: php php-sign.php <body> <timestamp> <secret>\n");

    exit(1);
}

echo \Conserje\Webhook\WebhookDispatcher::sign($argv[1], (int) $argv[2], $argv[3]);
