<?php

declare(strict_types=1);

namespace Conserje;

use Anthropic\Client;
use Conserje\Chat\ChatService;
use Conserje\Config\SiteRepository;
use Conserje\Conversation\FileConversationStore;
use Conserje\Llm\ClaudeChatModel;
use Conserje\Qualification\LeadScorer;
use Conserje\Qualification\PromptBuilder;
use Conserje\RateLimit\FileRateLimiter;
use Conserje\RateLimit\RateLimiter;
use Conserje\Support\Clock;
use Conserje\Support\Env;
use Conserje\Support\SystemClock;
use Conserje\Webhook\LeadDelivery;
use Conserje\Webhook\WebhookDispatcher;

/**
 * Wires the object graph.
 *
 * Small enough not to warrant a DI container, explicit enough that the
 * dependencies of every component are readable in one place.
 */
final class App
{
    public const CONVERSATION_TTL = 86400;

    private function __construct(
        public readonly SiteRepository $sites,
        public readonly ChatService $chat,
        public readonly RateLimiter $rateLimiter,
        public readonly Clock $clock,
        public readonly bool $trustProxy,
    ) {
    }

    public static function boot(string $baseDir): self
    {
        Env::load($baseDir . '/.env');

        $stateDir = self::resolvePath($baseDir, Env::get('CONSERJE_STATE_DIR', './var') ?? './var');
        $sitesDir = self::resolvePath($baseDir, Env::get('CONSERJE_SITES_DIR', '../sites') ?? '../sites');

        $clock = new SystemClock();

        $conversations = new FileConversationStore($stateDir . '/conversations', $clock);

        $model = new ClaudeChatModel(
            new Client(apiKey: Env::require('ANTHROPIC_API_KEY')),
            new PromptBuilder(),
        );

        $delivery = new LeadDelivery(
            new WebhookDispatcher(Env::get('CONSERJE_WEBHOOK_SECRET', '') ?? ''),
            $stateDir . '/spool',
        );

        return new self(
            sites: new SiteRepository($sitesDir),
            chat: new ChatService($model, $conversations, new LeadScorer(), $delivery, $clock),
            rateLimiter: new FileRateLimiter($stateDir . '/ratelimit', $clock),
            clock: $clock,
            trustProxy: filter_var(
                Env::get('CONSERJE_TRUST_PROXY', 'false'),
                FILTER_VALIDATE_BOOLEAN,
            ),
        );
    }

    private static function resolvePath(string $baseDir, string $path): string
    {
        if (str_starts_with($path, '/')) {
            return rtrim($path, '/');
        }

        return rtrim($baseDir . '/' . ltrim($path, './'), '/');
    }
}
