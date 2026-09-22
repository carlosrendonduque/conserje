<?php

declare(strict_types=1);

namespace Conserje\Webhook;

use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;
use Conserje\Qualification\Lead;

/**
 * Hands a qualified lead to whatever picks it up downstream.
 *
 * Implementations must not throw: by the time this runs the visitor has held
 * up their end, and a delivery problem is an operational concern, not
 * something to surface in the chat. Return false and preserve the lead.
 */
interface LeadDeliverer
{
    public function deliver(Lead $lead, SiteConfig $site, Conversation $conversation, int $now): bool;
}
