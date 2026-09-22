<?php

declare(strict_types=1);

namespace Conserje\Llm;

use Anthropic\Client;
use Anthropic\Core\Exceptions\APIStatusException;
use Anthropic\Messages\Message as ApiMessage;
use Anthropic\Messages\ToolUseBlock;
use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;
use Conserje\Conversation\Message;
use Conserje\Qualification\PromptBuilder;

/**
 * Claude-backed implementation of the qualification turn.
 *
 * Two things are worth knowing about the request shape:
 *
 * 1. The system prompt and tool definition are rendered from site config only,
 *    and the cache breakpoint sits on the last system block. Tools and system
 *    render ahead of messages, so that prefix is byte-identical for every
 *    visitor on a site and consecutive conversations read it from cache.
 *
 * 2. Effort is pinned low. Qualification is a short, latency-sensitive
 *    exchange where the visitor is watching a typing indicator; thinking stays
 *    on (disabling it on this model tier causes tool calls to leak into
 *    visible text) but is kept shallow.
 */
final class ClaudeChatModel implements ChatModel
{
    private const MAX_TOKENS = 1024;

    public function __construct(
        private readonly Client $client,
        private readonly PromptBuilder $prompts,
    ) {
    }

    public function respond(Conversation $conversation, SiteConfig $site): TurnOutcome
    {
        $system = [[
            'type' => 'text',
            'text' => $this->prompts->systemPrompt($site),
            'cacheControl' => ['type' => 'ephemeral'],
        ]];

        $tools = [$this->prompts->leadTool($site)];
        $messages = $this->toApiMessages($conversation);

        $response = $this->call($site, $system, $tools, $messages);
        $usage = $this->usageOf($response);

        $toolUse = $this->findLeadToolUse($response);

        if ($toolUse === null) {
            return new TurnOutcome($this->textOf($response), null, $usage);
        }

        // The model recorded a lead. Close the tool loop so the sign-off is
        // written by the model rather than stitched together from a template.
        $messages[] = ['role' => 'assistant', 'content' => $response->content];
        $messages[] = ['role' => 'user', 'content' => [[
            'type' => 'tool_result',
            'toolUseID' => $toolUse->id,
            'content' => 'Recorded. A human will pick this up.',
        ]]];

        $closing = $this->call($site, $system, $tools, $messages);

        /** @var array<string,mixed> $input */
        $input = $toolUse->input;

        return new TurnOutcome(
            $this->textOf($closing) ?: $this->textOf($response),
            $input,
            $usage->plus($this->usageOf($closing)),
        );
    }

    /**
     * @param list<array<string,mixed>> $system
     * @param list<array<string,mixed>> $tools
     * @param list<array<string,mixed>> $messages
     *
     * @throws ChatModelException
     */
    private function call(SiteConfig $site, array $system, array $tools, array $messages): ApiMessage
    {
        try {
            return $this->client->messages->create(
                maxTokens: self::MAX_TOKENS,
                messages: $messages,
                model: $site->model,
                outputConfig: ['effort' => 'low'],
                system: $system,
                tools: $tools,
            );
        } catch (APIStatusException $e) {
            $type = $e->type?->value ?? '';
            $retryable = in_array($type, ['rate_limit_error', 'overloaded_error', 'api_error'], true);

            throw new ChatModelException("Model request failed ({$type}).", $retryable, $e);
        } catch (\Throwable $e) {
            // Transport-level failures are worth one retry from the widget.
            throw new ChatModelException('Model request failed.', true, $e);
        }
    }

    /** @return list<array<string,mixed>> */
    private function toApiMessages(Conversation $conversation): array
    {
        $messages = [];

        foreach ($conversation->messages() as $message) {
            $messages[] = [
                'role' => $message->role === Message::ROLE_ASSISTANT ? 'assistant' : 'user',
                'content' => $message->text,
            ];
        }

        return $messages;
    }

    private function findLeadToolUse(ApiMessage $response): ?ToolUseBlock
    {
        foreach ($response->content as $block) {
            if ($block instanceof ToolUseBlock && $block->name === PromptBuilder::TOOL_NAME) {
                return $block;
            }
        }

        return null;
    }

    /** Concatenate text blocks, skipping thinking and tool-use blocks. */
    private function textOf(ApiMessage $response): string
    {
        $parts = [];

        foreach ($response->content as $block) {
            if ($block->type === 'text' && isset($block->text) && is_string($block->text)) {
                $parts[] = $block->text;
            }
        }

        return trim(implode("\n\n", $parts));
    }

    private function usageOf(ApiMessage $response): Usage
    {
        $usage = $response->usage;

        return new Usage(
            inputTokens: $usage->inputTokens ?? 0,
            outputTokens: $usage->outputTokens ?? 0,
            cacheCreationInputTokens: $usage->cacheCreationInputTokens ?? 0,
            cacheReadInputTokens: $usage->cacheReadInputTokens ?? 0,
        );
    }
}
