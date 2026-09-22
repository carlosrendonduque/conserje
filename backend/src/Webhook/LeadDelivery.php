<?php

declare(strict_types=1);

namespace Conserje\Webhook;

use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;
use Conserje\Qualification\Lead;

/**
 * Delivers a lead, and makes sure a failed delivery is recoverable.
 *
 * The visitor's side of the transaction is already complete by the time this
 * runs, so an n8n outage must not lose the lead and must not produce an error
 * the visitor can see. Anything that fails to deliver is written to a spool
 * directory and can be replayed with `bin/retry-spool.php`.
 */
final class LeadDelivery implements LeadDeliverer
{
    public function __construct(
        private readonly WebhookDispatcher $dispatcher,
        private readonly string $spoolDirectory,
        private readonly ?\Closure $logger = null,
    ) {
    }

    public function deliver(Lead $lead, SiteConfig $site, Conversation $conversation, int $now): bool
    {
        $payload = WebhookPayload::build($lead, $site, $conversation, $now);
        $url = getenv($site->webhookUrlEnv);

        if (!is_string($url) || trim($url) === '') {
            $this->spool($site->id, $payload, "no URL in \${$site->webhookUrlEnv}");

            return false;
        }

        try {
            $this->dispatcher->send($url, $payload, $now);

            return true;
        } catch (WebhookException $e) {
            $this->spool($site->id, $payload, $e->getMessage());

            return false;
        }
    }

    /** @param array<string,mixed> $payload */
    private function spool(string $siteId, array $payload, string $reason): void
    {
        $this->log("lead delivery failed for site '{$siteId}': {$reason}");

        if (!is_dir($this->spoolDirectory)
            && !mkdir($this->spoolDirectory, 0770, true)
            && !is_dir($this->spoolDirectory)
        ) {
            $this->log('spool directory is not writable; lead could not be preserved');

            return;
        }

        $name = sprintf('%d-%s-%s.json', time(), $siteId, bin2hex(random_bytes(4)));
        $path = rtrim($this->spoolDirectory, '/') . '/' . $name;

        $record = [
            'siteId' => $siteId,
            'reason' => $reason,
            'spooledAt' => time(),
            'payload' => $payload,
        ];

        $encoded = json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        if ($encoded === false || file_put_contents($path, $encoded, LOCK_EX) === false) {
            $this->log('could not write spooled lead to disk');
        }
    }

    private function log(string $message): void
    {
        if ($this->logger !== null) {
            ($this->logger)($message);

            return;
        }

        error_log('[conserje] ' . $message);
    }
}
