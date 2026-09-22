<?php

declare(strict_types=1);

namespace Conserje\Tests\Support;

use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;
use Conserje\Llm\ChatModel;
use Conserje\Llm\ChatModelException;
use Conserje\Llm\TurnOutcome;
use Conserje\Llm\Usage;

/**
 * Scripted stand-in for the provider.
 *
 * Every test in this suite runs against this, which is the point of the
 * ChatModel interface: the qualification flow is verifiable without spending
 * a cent or depending on the network.
 */
final class FakeChatModel implements ChatModel
{
    /** @var list<TurnOutcome|ChatModelException> */
    private array $script;

    public int $calls = 0;

    /** @var list<Conversation> */
    public array $seen = [];

    /** @param list<TurnOutcome|ChatModelException> $script */
    public function __construct(array $script)
    {
        $this->script = $script;
    }

    public static function replying(string ...$replies): self
    {
        return new self(array_map(
            static fn (string $reply): TurnOutcome => new TurnOutcome($reply, null, new Usage()),
            $replies,
        ));
    }

    /** @param array<string,mixed> $leadInput */
    public static function recordingLead(string $reply, array $leadInput): self
    {
        return new self([new TurnOutcome($reply, $leadInput, new Usage())]);
    }

    public static function failing(bool $retryable = true): self
    {
        return new self([new ChatModelException('upstream is down', $retryable)]);
    }

    public function respond(Conversation $conversation, SiteConfig $site): TurnOutcome
    {
        $this->seen[] = clone $conversation;
        $step = $this->script[$this->calls] ?? null;
        ++$this->calls;

        if ($step === null) {
            throw new \LogicException('FakeChatModel ran out of scripted turns.');
        }

        if ($step instanceof ChatModelException) {
            throw $step;
        }

        return $step;
    }
}
