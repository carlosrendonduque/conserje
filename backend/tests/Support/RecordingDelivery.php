<?php

declare(strict_types=1);

namespace Conserje\Tests\Support;

use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;
use Conserje\Qualification\Lead;
use Conserje\Webhook\LeadDeliverer;

/** Captures deliveries instead of making a request, and can simulate an outage. */
final class RecordingDelivery implements LeadDeliverer
{
    /** @var list<array{lead:Lead,site:SiteConfig,conversation:Conversation,now:int}> */
    public array $delivered = [];

    public function __construct(private readonly bool $succeeds = true)
    {
    }

    public function deliver(Lead $lead, SiteConfig $site, Conversation $conversation, int $now): bool
    {
        $this->delivered[] = [
            'lead' => $lead,
            'site' => $site,
            'conversation' => $conversation,
            'now' => $now,
        ];

        return $this->succeeds;
    }
}
