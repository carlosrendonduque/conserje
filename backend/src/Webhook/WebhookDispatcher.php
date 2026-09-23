<?php

declare(strict_types=1);

namespace Conserje\Webhook;

/**
 * Delivers qualified leads to n8n over a signed POST.
 *
 * An n8n webhook URL is effectively public: anyone who learns it can post to
 * it. So every request carries an HMAC-SHA256 signature over
 * `timestamp.body`, and the workflow verifies it before touching the payload.
 * Including the timestamp inside the signed material is what stops a captured
 * request from being replayed later.
 */
final class WebhookDispatcher
{
    public const SIGNATURE_HEADER = 'X-Conserje-Signature';
    public const TIMESTAMP_HEADER = 'X-Conserje-Timestamp';

    public function __construct(
        private readonly string $secret,
        private readonly int $timeoutSeconds = 5,
    ) {
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @throws WebhookException
     */
    public function send(string $url, array $payload, int $timestamp): void
    {
        if ($this->secret === '') {
            throw new WebhookException('Refusing to dispatch: no webhook secret configured.');
        }

        try {
            $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        } catch (\JsonException $e) {
            throw new WebhookException('Could not encode webhook payload.', $e);
        }

        $signature = self::sign($body, $timestamp, $this->secret);
        $handle = curl_init($url);

        if ($handle === false) {
            throw new WebhookException('Could not initialise the webhook request.');
        }

        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => $this->timeoutSeconds,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                self::SIGNATURE_HEADER . ': ' . $signature,
                self::TIMESTAMP_HEADER . ': ' . $timestamp,
            ],
        ]);

        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);

        // No curl_close(): since PHP 8.0 the handle is an object freed when it
        // goes out of scope, and calling it is deprecated as of 8.5 -- which
        // on a default CLI config prints a warning into the response body.
        unset($handle);

        if ($response === false) {
            throw new WebhookException("Webhook transport failed: {$error}");
        }

        if ($status < 200 || $status >= 300) {
            throw new WebhookException("Webhook rejected the payload with HTTP {$status}.");
        }
    }

    /** Signature material is `timestamp.body`, hex-encoded HMAC-SHA256. */
    public static function sign(string $body, int $timestamp, string $secret): string
    {
        return hash_hmac('sha256', $timestamp . '.' . $body, $secret);
    }

    /**
     * Reference verifier, mirrored by the Code node in the n8n workflow.
     * Kept here so the two implementations can be diffed against one test.
     */
    public static function verify(
        string $body,
        int $timestamp,
        string $signature,
        string $secret,
        int $now,
        int $toleranceSeconds = 300,
    ): bool {
        if (abs($now - $timestamp) > $toleranceSeconds) {
            return false;
        }

        return hash_equals(self::sign($body, $timestamp, $secret), $signature);
    }
}
