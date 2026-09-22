<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Conversation\Conversation;
use Conserje\Conversation\FileConversationStore;
use Conserje\Conversation\Message;
use Conserje\Support\FrozenClock;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class FileConversationStoreTest extends TestCase
{
    private string $dir;
    private FrozenClock $clock;
    private FileConversationStore $store;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/conserje-store-' . bin2hex(random_bytes(6));
        $this->clock = new FrozenClock(1_700_000_000);
        $this->store = new FileConversationStore($this->dir, $this->clock);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }

        @rmdir($this->dir);
    }

    #[Test]
    public function it_round_trips_a_conversation(): void
    {
        $id = bin2hex(random_bytes(16));
        $conversation = Conversation::start($id, 'site-a', $this->clock->now());
        $conversation->append(Message::user('hola'));
        $conversation->append(Message::assistant('¿en qué trabajas?'));

        $this->store->save($conversation);
        $loaded = $this->store->find($id);

        self::assertNotNull($loaded);
        self::assertSame('site-a', $loaded->siteId);
        self::assertCount(2, $loaded->messages());
        self::assertSame('¿en qué trabajas?', $loaded->messages()[1]->text, 'UTF-8 must survive');
        self::assertSame(1, $loaded->userTurns());
    }

    #[Test]
    public function it_preserves_the_closed_flag(): void
    {
        $id = bin2hex(random_bytes(16));
        $conversation = Conversation::start($id, 'site-a', $this->clock->now());
        $conversation->close('lead_recorded');

        $this->store->save($conversation);
        $loaded = $this->store->find($id);

        self::assertNotNull($loaded);
        self::assertTrue($loaded->isClosed());
        self::assertSame('lead_recorded', $loaded->closedReason());
    }

    #[Test]
    public function a_missing_conversation_is_null(): void
    {
        self::assertNull($this->store->find(bin2hex(random_bytes(16))));
    }

    #[Test]
    #[DataProvider('unsafeIds')]
    public function it_refuses_unsafe_session_ids(string $id): void
    {
        // The id reaches this class straight from a request body, so the
        // allowlist here is the only thing preventing path traversal.
        self::assertNull($this->store->find($id));
    }

    /** @return iterable<string,array{string}> */
    public static function unsafeIds(): iterable
    {
        yield 'traversal' => ['../../etc/passwd'];
        yield 'slash' => ['abc/def'];
        yield 'null byte' => ["abcdef\0"];
        yield 'too short' => ['abc'];
        yield 'uppercase hex' => [str_repeat('A', 32)];
        yield 'non hex' => [str_repeat('z', 32)];
        yield 'empty' => [''];
    }

    #[Test]
    public function saving_an_unsafe_id_throws_rather_than_writing(): void
    {
        $conversation = Conversation::fromArray([
            'id' => '../escape',
            'siteId' => 'site-a',
            'createdAt' => 1,
            'messages' => [],
        ]);

        $this->expectException(\InvalidArgumentException::class);

        $this->store->save($conversation);
    }

    #[Test]
    public function corrupt_state_reads_as_absent_instead_of_throwing(): void
    {
        $id = bin2hex(random_bytes(16));
        mkdir($this->dir, 0770, true);
        file_put_contents($this->dir . '/' . $id . '.json', '{ this is not json');

        self::assertNull($this->store->find($id));
    }

    #[Test]
    public function purge_removes_only_what_is_past_the_window(): void
    {
        $old = bin2hex(random_bytes(16));
        $fresh = bin2hex(random_bytes(16));

        $this->store->save(Conversation::start($old, 'site-a', $this->clock->now()));
        $this->store->save(Conversation::start($fresh, 'site-a', $this->clock->now()));

        touch($this->dir . '/' . $old . '.json', $this->clock->now() - 7200);

        $removed = $this->store->purgeOlderThan(3600);

        self::assertSame(1, $removed);
        self::assertNull($this->store->find($old));
        self::assertNotNull($this->store->find($fresh));
    }

    #[Test]
    public function purging_a_directory_that_does_not_exist_is_harmless(): void
    {
        $store = new FileConversationStore($this->dir . '/nope', $this->clock);

        self::assertSame(0, $store->purgeOlderThan(60));
    }
}
