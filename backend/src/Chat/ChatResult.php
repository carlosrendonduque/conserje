<?php

declare(strict_types=1);

namespace Conserje\Chat;

use Conserje\Qualification\Lead;

/** What the widget needs to render one exchange. */
final class ChatResult
{
    public function __construct(
        public readonly string $sessionId,
        public readonly string $reply,
        public readonly bool $done,
        public readonly ?string $doneReason = null,
        public readonly ?Lead $lead = null,
    ) {
    }

    /**
     * Response body for the widget.
     *
     * The lead itself is never returned: the visitor supplied it, the widget
     * has no use for it, and echoing a score back to the browser tells anyone
     * watching exactly how to game the routing.
     *
     * @return array<string,mixed>
     */
    public function toResponseArray(): array
    {
        return [
            'session' => $this->sessionId,
            'reply' => $this->reply,
            'done' => $this->done,
            'reason' => $this->doneReason,
        ];
    }
}
