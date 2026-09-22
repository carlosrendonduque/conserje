<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\RateLimit\FileRateLimiter;
use Conserje\Support\FrozenClock;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class FileRateLimiterTest extends TestCase
{
    private string $dir;
    private FrozenClock $clock;
    private FileRateLimiter $limiter;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/conserje-rl-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock(1_700_000_000);
        $this->limiter = new FileRateLimiter($this->dir, $this->clock);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }

        @rmdir($this->dir);
    }

    #[Test]
    public function it_allows_up_to_the_limit_and_then_stops(): void
    {
        for ($i = 0; $i < 3; ++$i) {
            self::assertTrue($this->limiter->allow('key', 3, 60), "hit {$i} should pass");
        }

        self::assertFalse($this->limiter->allow('key', 3, 60));
    }

    #[Test]
    public function keys_do_not_interfere(): void
    {
        self::assertTrue($this->limiter->allow('site-a:1.2.3.4', 1, 60));
        self::assertFalse($this->limiter->allow('site-a:1.2.3.4', 1, 60));
        self::assertTrue($this->limiter->allow('site-b:1.2.3.4', 1, 60));
    }

    #[Test]
    public function the_window_slides_rather_than_resetting_in_a_block(): void
    {
        // A fixed bucket would let the whole allowance be spent twice across
        // the boundary. Here each hit ages out on its own schedule.
        self::assertTrue($this->limiter->allow('key', 2, 60));
        $this->clock->advance(30);
        self::assertTrue($this->limiter->allow('key', 2, 60));
        self::assertFalse($this->limiter->allow('key', 2, 60));

        // The first hit is now 61s old; exactly one slot frees up.
        $this->clock->advance(31);
        self::assertTrue($this->limiter->allow('key', 2, 60));
        self::assertFalse($this->limiter->allow('key', 2, 60));
    }

    #[Test]
    public function a_zero_limit_denies_everything(): void
    {
        self::assertFalse($this->limiter->allow('key', 0, 60));
    }

    #[Test]
    public function a_key_is_hashed_so_an_ip_never_lands_on_disk_in_the_clear(): void
    {
        $this->limiter->allow('site-a:203.0.113.9', 5, 60);

        $files = glob($this->dir . '/*.window') ?: [];

        self::assertCount(1, $files);
        self::assertStringNotContainsString('203.0.113.9', basename($files[0]));
        self::assertStringNotContainsString('203.0.113.9', (string) file_get_contents($files[0]));
    }
}
