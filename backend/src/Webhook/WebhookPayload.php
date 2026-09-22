<?php

declare(strict_types=1);

namespace Conserje\Webhook;

use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;
use Conserje\Conversation\Message;
use Conserje\Qualification\Lead;

/**
 * The contract between this backend and n8n.
 *
 * Shape changes here are breaking changes for every workflow downstream, so
 * the version field is part of the payload and the tests assert the keys.
 */
final class WebhookPayload
{
    public const VERSION = 1;

    /** @return array<string,mixed> */
    public static function build(
        Lead $lead,
        SiteConfig $site,
        Conversation $conversation,
        int $timestamp,
    ): array {
        return [
            'version' => self::VERSION,
            'event' => 'lead.qualified',
            'timestamp' => $timestamp,
            'site' => [
                'id' => $site->id,
                'name' => $site->name,
                'locale' => $site->locale,
            ],
            'lead' => $lead->toArray(),
            'conversation' => [
                'id' => $conversation->id,
                'startedAt' => $conversation->createdAt,
                'turns' => $conversation->userTurns(),
                // The full transcript travels with the lead: whoever picks it
                // up should be able to read what was actually said rather than
                // trust the summary.
                'transcript' => array_map(
                    static fn (Message $m): array => ['role' => $m->role, 'text' => $m->text],
                    $conversation->messages(),
                ),
            ],
        ];
    }
}
