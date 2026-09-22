<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Support\Path;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class PathTest extends TestCase
{
    #[Test]
    #[DataProvider('cases')]
    public function it_resolves(string $base, string $path, string $expected): void
    {
        self::assertSame($expected, Path::resolve($base, $path));
    }

    /** @return iterable<string,array{string,string,string}> */
    public static function cases(): iterable
    {
        yield 'parent directory is preserved' => ['/app/backend', '../sites', '/app/backend/../sites'];
        yield 'leading dot-slash is dropped once' => ['/app/backend', './var', '/app/backend/var'];
        yield 'plain relative path' => ['/app/backend', 'var', '/app/backend/var'];
        yield 'absolute path wins' => ['/app/backend', '/srv/state', '/srv/state'];
        yield 'trailing slash is trimmed' => ['/app/backend/', 'var/', '/app/backend/var'];
        yield 'empty path is the base' => ['/app/backend', '', '/app/backend'];
        yield 'whitespace is ignored' => ['/app/backend', '  ../sites  ', '/app/backend/../sites'];
    }

    #[Test]
    public function a_parent_reference_actually_reaches_the_parent(): void
    {
        // The regression this class exists for: ltrim($path, './') collapsed
        // '../sites' to 'sites' and the app looked in the wrong directory.
        $resolved = Path::resolve('/app/backend', '../sites');

        self::assertNotSame('/app/backend/sites', $resolved);
        self::assertSame('/app/sites', realpath('/') === null ? '/app/sites' : self::normalize($resolved));
    }

    private static function normalize(string $path): string
    {
        $parts = [];

        foreach (explode('/', $path) as $segment) {
            if ($segment === '..') {
                array_pop($parts);
            } elseif ($segment !== '' && $segment !== '.') {
                $parts[] = $segment;
            }
        }

        return '/' . implode('/', $parts);
    }
}
