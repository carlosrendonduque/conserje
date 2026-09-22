<?php

declare(strict_types=1);

namespace Conserje\Http;

/** Emits a JSON response with the headers this API always sends. */
final class JsonResponse
{
    /** @param array<string,mixed> $body */
    public static function send(array $body, int $status = 200, array $headers = []): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');

        // The widget's answers are per-visitor and must never sit in a shared
        // cache, and the API returns no HTML, so sniffing only adds risk.
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');

        foreach ($headers as $name => $value) {
            header("{$name}: {$value}");
        }

        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function error(string $code, string $message, int $status, bool $retryable = false): void
    {
        self::send(
            ['error' => ['code' => $code, 'message' => $message, 'retryable' => $retryable]],
            $status,
        );
    }
}
