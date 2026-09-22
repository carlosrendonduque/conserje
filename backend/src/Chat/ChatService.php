<?php

declare(strict_types=1);

namespace Conserje\Chat;

use Conserje\Config\SiteConfig;
use Conserje\Conversation\Conversation;
use Conserje\Conversation\ConversationStore;
use Conserje\Conversation\Message;
use Conserje\Llm\ChatModel;
use Conserje\Llm\ChatModelException;
use Conserje\Qualification\Lead;
use Conserje\Qualification\LeadScorer;
use Conserje\Support\Clock;
use Conserje\Webhook\LeadDeliverer;

/**
 * Drives one turn of the qualification conversation.
 *
 * This is the only place that decides whether a visitor gets to spend a model
 * call, so every limit is enforced here rather than in the transport layer.
 */
final class ChatService
{
    public function __construct(
        private readonly ChatModel $model,
        private readonly ConversationStore $conversations,
        private readonly LeadScorer $scorer,
        private readonly LeadDeliverer $delivery,
        private readonly Clock $clock,
    ) {
    }

    /**
     * @throws ChatException
     */
    public function handle(SiteConfig $site, ?string $sessionId, string $userMessage): ChatResult
    {
        $text = trim($userMessage);

        if ($text === '') {
            throw ChatException::emptyMessage();
        }

        if (mb_strlen($text) > $site->maxMessageChars) {
            throw ChatException::messageTooLong($site->maxMessageChars);
        }

        $conversation = $this->resolveConversation($site, $sessionId);

        if ($conversation->isClosed()) {
            throw ChatException::sessionClosed();
        }

        // Checked before the model call: the cap exists to bound cost, so it
        // has to bite before the money is spent.
        if ($conversation->userTurns() >= $site->maxTurns) {
            $conversation->close(ChatException::TURN_LIMIT);
            $this->conversations->save($conversation);

            return new ChatResult(
                sessionId: $conversation->id,
                reply: $this->turnLimitReply($site),
                done: true,
                doneReason: ChatException::TURN_LIMIT,
            );
        }

        $conversation->append(Message::user($text));

        try {
            $outcome = $this->model->respond($conversation, $site);
        } catch (ChatModelException $e) {
            // The visitor's message is deliberately not persisted on failure,
            // so a retry replays the same turn instead of duplicating it.
            throw ChatException::upstreamUnavailable($e->retryable, $e);
        }

        $conversation->append(Message::assistant($outcome->reply));

        if (!$outcome->producedLead()) {
            $this->conversations->save($conversation);

            return new ChatResult($conversation->id, $outcome->reply, false);
        }

        $lead = $this->recordLead($outcome->leadInput ?? [], $site, $conversation);

        $conversation->close('lead_recorded');
        $this->conversations->save($conversation);

        return new ChatResult(
            sessionId: $conversation->id,
            reply: $outcome->reply,
            done: true,
            doneReason: 'lead_recorded',
            lead: $lead,
        );
    }

    /**
     * Score, build and dispatch the lead.
     *
     * A delivery failure must never surface to the visitor: they finished
     * their part correctly. LeadDelivery spools anything it cannot deliver so
     * the lead survives an n8n outage.
     *
     * @param array<string,mixed> $toolInput
     */
    private function recordLead(array $toolInput, SiteConfig $site, Conversation $conversation): ?Lead
    {
        $score = $this->scorer->score($toolInput, $site);
        $tier = $this->scorer->tier($score, $site);

        try {
            $lead = Lead::fromToolInput($toolInput, $score, $tier);
        } catch (\InvalidArgumentException) {
            // The model called the tool without a usable need. Nothing to
            // route, and nothing the visitor should be told about.
            return null;
        }

        $this->delivery->deliver($lead, $site, $conversation, $this->clock->now());

        return $lead;
    }

    private function resolveConversation(SiteConfig $site, ?string $sessionId): Conversation
    {
        if ($sessionId !== null && $sessionId !== '') {
            $existing = $this->conversations->find($sessionId);

            // A session from another site is treated as absent rather than
            // rejected, so one tenant can never read another's transcript.
            if ($existing !== null && $existing->siteId === $site->id) {
                return $existing;
            }
        }

        return Conversation::start(bin2hex(random_bytes(16)), $site->id, $this->clock->now());
    }

    private function turnLimitReply(SiteConfig $site): string
    {
        return str_starts_with($site->locale, 'es')
            ? 'Creo que ya tengo bastante para pasarle esto a una persona. Escríbenos y seguimos por ahí.'
            : 'I think I have enough to pass this to a person. Drop us a line and we will pick it up there.';
    }
}
