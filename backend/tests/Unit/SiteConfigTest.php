<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Config\ConfigException;
use Conserje\Config\SiteConfig;
use Conserje\Tests\Support\SiteFactory;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class SiteConfigTest extends TestCase
{
    #[Test]
    public function it_applies_documented_defaults(): void
    {
        $site = SiteFactory::make();

        self::assertSame('claude-opus-5', $site->model);
        self::assertSame(14, $site->maxTurns);
        self::assertSame(1200, $site->maxMessageChars);
        self::assertSame(60, $site->requestsPerHour);
    }

    #[Test]
    public function it_matches_origins_exactly(): void
    {
        $site = SiteFactory::make(['allowedOrigins' => ['https://example.com']]);

        self::assertTrue($site->allowsOrigin('https://example.com'));
        self::assertFalse($site->allowsOrigin('http://example.com'), 'scheme must match');
        self::assertFalse($site->allowsOrigin('https://evil-example.com'), 'no substring matching');
        self::assertFalse($site->allowsOrigin('https://example.com.evil.test'), 'no suffix matching');
        self::assertFalse($site->allowsOrigin('https://sub.example.com'), 'no implicit subdomains');
        self::assertFalse($site->allowsOrigin(null));
    }

    #[Test]
    public function it_rejects_an_origin_with_a_trailing_slash(): void
    {
        // Browsers never send one, so a config with a slash would silently
        // never match and the widget would look broken for no visible reason.
        $this->expectException(ConfigException::class);
        $this->expectExceptionMessageMatches('/must not end in a slash/');

        SiteFactory::make(['allowedOrigins' => ['https://example.com/']]);
    }

    #[Test]
    public function it_rejects_a_site_with_no_origins(): void
    {
        $this->expectException(ConfigException::class);

        SiteFactory::make(['allowedOrigins' => []]);
    }

    #[Test]
    public function it_rejects_overlapping_score_thresholds(): void
    {
        $this->expectException(ConfigException::class);
        $this->expectExceptionMessageMatches('/warmScoreThreshold/');

        SiteFactory::make(['hotScoreThreshold' => 50, 'warmScoreThreshold' => 60]);
    }

    #[Test]
    public function it_rejects_an_unsafe_site_id(): void
    {
        $this->expectException(ConfigException::class);

        SiteFactory::make(['id' => '../../etc/passwd']);
    }

    #[Test]
    public function it_requires_a_business_context(): void
    {
        $this->expectException(ConfigException::class);

        SiteConfig::fromArray([
            'id' => 'x',
            'name' => 'X',
            'allowedOrigins' => ['https://x.test'],
            'greeting' => 'hi',
            'collect' => ['a'],
            'budgetBands' => ['a'],
            'webhookUrlEnv' => 'X',
        ]);
    }
}
