<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\App;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * Boots the real object graph.
 *
 * Every other test runs against fakes, which is what makes them fast and
 * free -- but it also means none of them would notice a missing dependency,
 * a wrong constructor argument, or an unresolvable path. This one would: the
 * Anthropic SDK needs a PSR-18 client it does not declare a concrete
 * implementation for, and without this test the first sign of that is a 503
 * in production.
 */
final class AppBootTest extends TestCase
{
    private string $stateDir;

    protected function setUp(): void
    {
        $this->stateDir = sys_get_temp_dir() . '/conserje-boot-' . bin2hex(random_bytes(6));

        putenv('ANTHROPIC_API_KEY=sk-ant-not-a-real-key');
        putenv('CONSERJE_SITES_DIR=' . dirname(__DIR__, 3) . '/sites');
        putenv('CONSERJE_STATE_DIR=' . $this->stateDir);
        putenv('CONSERJE_WEBHOOK_SECRET=test-secret');
    }

    protected function tearDown(): void
    {
        foreach (['ANTHROPIC_API_KEY', 'CONSERJE_SITES_DIR', 'CONSERJE_STATE_DIR', 'CONSERJE_WEBHOOK_SECRET'] as $key) {
            putenv($key);
        }

        foreach (glob($this->stateDir . '/*/*') ?: [] as $file) {
            @unlink($file);
        }

        foreach (glob($this->stateDir . '/*') ?: [] as $dir) {
            @rmdir($dir);
        }

        @rmdir($this->stateDir);
    }

    #[Test]
    public function the_application_wires_up(): void
    {
        $app = App::boot(dirname(__DIR__, 2));

        self::assertNotEmpty($app->sites->ids());
        self::assertFalse($app->trustProxy, 'proxy headers must not be trusted by default');
    }

    #[Test]
    public function the_shipped_site_configs_are_valid(): void
    {
        // A malformed config in sites/ takes the whole service down at boot,
        // so the ones in this repository are checked rather than assumed.
        $app = App::boot(dirname(__DIR__, 2));

        foreach ($app->sites->ids() as $id) {
            $site = $app->sites->get($id);

            self::assertSame($id, $site->id);
            self::assertNotEmpty($site->allowedOrigins);
            self::assertNotEmpty($site->budgetBands);
            self::assertStringStartsWith('CONSERJE_WEBHOOK_', $site->webhookUrlEnv);
        }
    }

    #[Test]
    public function boot_fails_loudly_without_an_api_key(): void
    {
        putenv('ANTHROPIC_API_KEY');

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/ANTHROPIC_API_KEY/');

        // Booted from a directory with no .env: on a developer machine the
        // real backend/.env holds a key, and Env::load would put it straight
        // back into the environment this test just cleared.
        mkdir($this->stateDir, 0700, true);

        App::boot($this->stateDir);
    }
}
