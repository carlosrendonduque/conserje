<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Chat\ChatException;
use Conserje\Chat\ChatService;
use Conserje\Conversation\FileConversationStore;
use Conserje\Qualification\Lead;
use Conserje\Qualification\LeadScorer;
use Conserje\Support\FrozenClock;
use Conserje\Tests\Support\FakeChatModel;
use Conserje\Tests\Support\RecordingDelivery;
use Conserje\Tests\Support\SiteFactory;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class ChatServiceTest extends TestCase
{
    private string $stateDir;
    private FrozenClock $clock;
    private FileConversationStore $store;

    protected function setUp(): void
    {
        $this->stateDir = sys_get_temp_dir() . '/conserje-test-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock(1_700_000_000);
        $this->store = new FileConversationStore($this->stateDir, $this->clock);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->stateDir . '/*') ?: [] as $file) {
            @unlink($file);
        }

        @rmdir($this->stateDir);
    }

    private function service(
        FakeChatModel $model,
        ?RecordingDelivery $delivery = null,
    ): array {
        $delivery ??= new RecordingDelivery();

        return [
            new ChatService($model, $this->store, new LeadScorer(), $delivery, $this->clock),
            $delivery,
        ];
    }

    #[Test]
    public function it_starts_a_session_and_returns_the_reply(): void
    {
        [$service] = $this->service(FakeChatModel::replying('What are you building?'));

        $result = $service->handle(SiteFactory::make(), null, 'I need a website');

        self::assertNotSame('', $result->sessionId);
        self::assertSame('What are you building?', $result->reply);
        self::assertFalse($result->done);
    }

    #[Test]
    public function it_continues_an_existing_session(): void
    {
        $model = FakeChatModel::replying('First?', 'Second?');
        [$service] = $this->service($model);
        $site = SiteFactory::make();

        $first = $service->handle($site, null, 'hello');
        $second = $service->handle($site, $first->sessionId, 'a shop site');

        self::assertSame($first->sessionId, $second->sessionId);
        self::assertSame('Second?', $second->reply);

        // The second model call must see the whole transcript so far:
        // two visitor messages and the assistant turn between them.
        self::assertCount(3, $model->seen[1]->messages());
    }

    #[Test]
    public function a_session_from_another_site_is_never_reused(): void
    {
        // Otherwise a session id leaked from one tenant would read another
        // tenant's transcript.
        $model = FakeChatModel::replying('One?', 'Two?');
        [$service] = $this->service($model);

        $first = $service->handle(SiteFactory::make(['id' => 'site-a']), null, 'hi');
        $second = $service->handle(
            SiteFactory::make(['id' => 'site-b']),
            $first->sessionId,
            'hi',
        );

        self::assertNotSame($first->sessionId, $second->sessionId);
        self::assertCount(1, $model->seen[1]->messages());
    }

    #[Test]
    public function an_unknown_session_id_starts_a_fresh_conversation(): void
    {
        [$service] = $this->service(FakeChatModel::replying('Hello?'));

        $result = $service->handle(SiteFactory::make(), str_repeat('f', 32), 'hi');

        self::assertNotSame(str_repeat('f', 32), $result->sessionId);
        self::assertFalse($result->done);
    }

    #[Test]
    public function it_rejects_an_empty_message_before_spending_a_model_call(): void
    {
        $model = FakeChatModel::replying('never reached');
        [$service] = $this->service($model);

        try {
            $service->handle(SiteFactory::make(), null, "   \n  ");
            self::fail('expected a ChatException');
        } catch (ChatException $e) {
            self::assertSame(ChatException::EMPTY_MESSAGE, $e->errorCode);
        }

        self::assertSame(0, $model->calls);
    }

    #[Test]
    public function it_rejects_an_oversized_message_before_spending_a_model_call(): void
    {
        $model = FakeChatModel::replying('never reached');
        [$service] = $this->service($model);
        $site = SiteFactory::make(['maxMessageChars' => 50]);

        try {
            $service->handle($site, null, str_repeat('x', 51));
            self::fail('expected a ChatException');
        } catch (ChatException $e) {
            self::assertSame(ChatException::MESSAGE_TOO_LONG, $e->errorCode);
            self::assertSame(400, $e->status);
        }

        self::assertSame(0, $model->calls);
    }

    #[Test]
    public function the_turn_cap_closes_the_conversation_without_calling_the_model(): void
    {
        $site = SiteFactory::make(['maxTurns' => 2]);
        $model = FakeChatModel::replying('One?', 'Two?', 'Three?');
        [$service] = $this->service($model);

        $first = $service->handle($site, null, 'a');
        $service->handle($site, $first->sessionId, 'b');
        $third = $service->handle($site, $first->sessionId, 'c');

        self::assertTrue($third->done);
        self::assertSame(ChatException::TURN_LIMIT, $third->doneReason);
        self::assertSame(2, $model->calls, 'the cap must bite before the third call');
    }

    #[Test]
    public function a_closed_conversation_cannot_be_reopened(): void
    {
        $site = SiteFactory::make();
        [$service] = $this->service(FakeChatModel::recordingLead(
            'Got it.',
            ['need' => 'a shop', 'email' => 'a@b.test'],
        ));

        $first = $service->handle($site, null, 'hi');
        self::assertTrue($first->done);

        $this->expectException(ChatException::class);
        $this->expectExceptionMessageMatches('/already finished/');

        $service->handle($site, $first->sessionId, 'one more thing');
    }

    #[Test]
    public function recording_a_lead_scores_it_and_dispatches_it(): void
    {
        $site = SiteFactory::make();
        [$service, $delivery] = $this->service(FakeChatModel::recordingLead(
            'Thanks, someone will be in touch.',
            [
                'need' => 'A booking system for my clinic, integrated with the calendar',
                'email' => 'ana@clinic.test',
                'phone' => '+57 300 000 0000',
                'company' => 'Clinic',
                'timeline' => 'this month',
                'budgetBand' => '15k-40k',
                'summary' => 'Clinic wants online booking.',
            ],
        ));

        $result = $service->handle($site, null, 'I need online booking');

        self::assertTrue($result->done);
        self::assertSame('lead_recorded', $result->doneReason);
        self::assertCount(1, $delivery->delivered);

        $lead = $delivery->delivered[0]['lead'];
        self::assertSame('ana@clinic.test', $lead->email);
        self::assertSame(Lead::TIER_HOT, $lead->tier);
        self::assertGreaterThanOrEqual(70, $lead->score);
    }

    #[Test]
    public function the_lead_never_reaches_the_browser(): void
    {
        // The score is the routing rule. Publishing it tells anyone watching
        // the network tab exactly what to say to get flagged hot.
        $site = SiteFactory::make();
        [$service] = $this->service(FakeChatModel::recordingLead(
            'Thanks.',
            ['need' => 'x', 'email' => 'a@b.test', 'budgetBand' => 'over-40k'],
        ));

        $body = $service->handle($site, null, 'hi')->toResponseArray();

        self::assertSame(['session', 'reply', 'done', 'reason'], array_keys($body));
        self::assertStringNotContainsString('score', json_encode($body, JSON_THROW_ON_ERROR));
    }

    #[Test]
    public function a_delivery_outage_does_not_break_the_visitors_experience(): void
    {
        $site = SiteFactory::make();
        [$service, $delivery] = $this->service(
            FakeChatModel::recordingLead('Thanks.', ['need' => 'x', 'email' => 'a@b.test']),
            new RecordingDelivery(succeeds: false),
        );

        $result = $service->handle($site, null, 'hi');

        self::assertTrue($result->done);
        self::assertSame('Thanks.', $result->reply);
        self::assertCount(1, $delivery->delivered);
    }

    #[Test]
    public function a_tool_call_with_no_usable_need_is_discarded(): void
    {
        $site = SiteFactory::make();
        [$service, $delivery] = $this->service(
            FakeChatModel::recordingLead('Thanks.', ['email' => 'a@b.test']),
        );

        $result = $service->handle($site, null, 'hi');

        self::assertTrue($result->done);
        self::assertNull($result->lead);
        self::assertCount(0, $delivery->delivered, 'nothing routable, nothing dispatched');
    }

    #[Test]
    public function an_upstream_failure_does_not_persist_the_visitors_turn(): void
    {
        // Otherwise a retry would send the same message twice and the model
        // would see a duplicated transcript.
        $site = SiteFactory::make();
        $model = FakeChatModel::replying('Hello?');
        [$first] = $this->service($model);

        $started = $first->handle($site, null, 'hi');

        [$failing] = $this->service(FakeChatModel::failing(retryable: true));

        try {
            $failing->handle($site, $started->sessionId, 'this one blows up');
            self::fail('expected a ChatException');
        } catch (ChatException $e) {
            self::assertSame(ChatException::UPSTREAM_UNAVAILABLE, $e->errorCode);
            self::assertSame(503, $e->status);
            self::assertTrue($e->retryable);
        }

        $stored = $this->store->find($started->sessionId);
        self::assertNotNull($stored);
        self::assertCount(2, $stored->messages(), 'the failed turn must not be recorded');
    }

    #[Test]
    public function a_non_retryable_upstream_failure_is_reported_as_such(): void
    {
        [$service] = $this->service(FakeChatModel::failing(retryable: false));

        try {
            $service->handle(SiteFactory::make(), null, 'hi');
            self::fail('expected a ChatException');
        } catch (ChatException $e) {
            self::assertFalse($e->retryable);
        }
    }
}
