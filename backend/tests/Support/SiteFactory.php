<?php

declare(strict_types=1);

namespace Conserje\Tests\Support;

use Conserje\Config\SiteConfig;

final class SiteFactory
{
    /** @param array<string,mixed> $overrides */
    public static function make(array $overrides = []): SiteConfig
    {
        return SiteConfig::fromArray(array_merge([
            'id' => 'test-site',
            'name' => 'Test Site',
            'locale' => 'en',
            'allowedOrigins' => ['https://example.com'],
            'greeting' => 'Hello.',
            'businessContext' => 'A business that does testing.',
            'collect' => ['What they need', 'An email address'],
            'budgetBands' => ['under-5k', '5k-15k', '15k-40k', 'over-40k'],
            'webhookUrlEnv' => 'CONSERJE_WEBHOOK_TEST',
        ], $overrides));
    }
}
