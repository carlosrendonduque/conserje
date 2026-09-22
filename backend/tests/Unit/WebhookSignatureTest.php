<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Webhook\WebhookDispatcher;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class WebhookSignatureTest extends TestCase
{
    private const SECRET = 'a-test-secret';

    #[Test]
    public function a_signature_verifies_against_its_own_payload(): void
    {
        $body = '{"event":"lead.qualified"}';
        $timestamp = 1_700_000_000;

        $signature = WebhookDispatcher::sign($body, $timestamp, self::SECRET);

        self::assertTrue(
            WebhookDispatcher::verify($body, $timestamp, $signature, self::SECRET, $timestamp),
        );
    }

    #[Test]
    public function a_tampered_body_fails(): void
    {
        $timestamp = 1_700_000_000;
        $signature = WebhookDispatcher::sign('{"score":10}', $timestamp, self::SECRET);

        self::assertFalse(
            WebhookDispatcher::verify('{"score":99}', $timestamp, $signature, self::SECRET, $timestamp),
        );
    }

    #[Test]
    public function the_wrong_secret_fails(): void
    {
        $body = '{"a":1}';
        $timestamp = 1_700_000_000;
        $signature = WebhookDispatcher::sign($body, $timestamp, self::SECRET);

        self::assertFalse(
            WebhookDispatcher::verify($body, $timestamp, $signature, 'another-secret', $timestamp),
        );
    }

    #[Test]
    public function a_captured_request_cannot_be_replayed_later(): void
    {
        $body = '{"a":1}';
        $timestamp = 1_700_000_000;
        $signature = WebhookDispatcher::sign($body, $timestamp, self::SECRET);

        // Same bytes, same signature, six minutes later.
        self::assertFalse(
            WebhookDispatcher::verify($body, $timestamp, $signature, self::SECRET, $timestamp + 360),
        );

        self::assertTrue(
            WebhookDispatcher::verify($body, $timestamp, $signature, self::SECRET, $timestamp + 60),
        );
    }

    #[Test]
    public function a_timestamp_from_the_future_is_also_rejected(): void
    {
        $body = '{"a":1}';
        $timestamp = 1_700_000_000;
        $signature = WebhookDispatcher::sign($body, $timestamp, self::SECRET);

        self::assertFalse(
            WebhookDispatcher::verify($body, $timestamp, $signature, self::SECRET, $timestamp - 600),
        );
    }

    #[Test]
    public function the_timestamp_is_part_of_the_signed_material(): void
    {
        $body = '{"a":1}';

        self::assertNotSame(
            WebhookDispatcher::sign($body, 1_700_000_000, self::SECRET),
            WebhookDispatcher::sign($body, 1_700_000_001, self::SECRET),
        );
    }

    #[Test]
    public function it_refuses_to_dispatch_without_a_secret(): void
    {
        $dispatcher = new WebhookDispatcher('');

        $this->expectException(\Conserje\Webhook\WebhookException::class);
        $this->expectExceptionMessageMatches('/no webhook secret/');

        $dispatcher->send('https://example.test/hook', ['a' => 1], time());
    }
}
