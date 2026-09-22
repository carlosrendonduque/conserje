<?php

declare(strict_types=1);

namespace Conserje\Webhook;

final class WebhookException extends \RuntimeException
{
    public function __construct(string $message, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
