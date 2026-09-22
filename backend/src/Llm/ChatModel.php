<?php

declare(strict_types=1);

namespace Conserje\Llm;

use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;

/**
 * The one seam between the qualification flow and the model provider.
 *
 * Kept deliberately small so the whole service can be tested without a network
 * call, and so swapping providers never reaches into ChatService.
 */
interface ChatModel
{
    /** @throws ChatModelException */
    public function respond(Conversation $conversation, SiteConfig $site): TurnOutcome;
}
