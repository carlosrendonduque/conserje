<?php

declare(strict_types=1);

namespace Conserje\Conversation;

use Conserje\Support\Clock;

/**
 * Filesystem-backed conversation store.
 *
 * Chosen as the default because it runs on any shared PHP host with no extra
 * services. Writes go through a temp file plus rename so a crashed request
 * cannot leave a half-written transcript on disk.
 */
final class FileConversationStore implements ConversationStore
{
    public function __construct(
        private readonly string $directory,
        private readonly Clock $clock,
    ) {
    }

    public function find(string $id): ?Conversation
    {
        $path = $this->pathFor($id);

        if ($path === null || !is_file($path)) {
            return null;
        }

        $contents = file_get_contents($path);

        if ($contents === false) {
            return null;
        }

        try {
            /** @var array<string,mixed> $decoded */
            $decoded = json_decode($contents, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            // Corrupt state is treated as absent; the visitor gets a fresh
            // session rather than a 500.
            return null;
        }

        return Conversation::fromArray($decoded);
    }

    public function save(Conversation $conversation): void
    {
        $path = $this->pathFor($conversation->id);

        if ($path === null) {
            throw new \InvalidArgumentException('Refusing to persist a conversation with an unsafe id.');
        }

        $this->ensureDirectory();

        $encoded = json_encode($conversation->toArray(), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        $temp = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';

        if (file_put_contents($temp, $encoded, LOCK_EX) === false) {
            throw new \RuntimeException('Could not write conversation state.');
        }

        if (!rename($temp, $path)) {
            @unlink($temp);

            throw new \RuntimeException('Could not commit conversation state.');
        }
    }

    public function purgeOlderThan(int $seconds): int
    {
        if (!is_dir($this->directory)) {
            return 0;
        }

        $cutoff = $this->clock->now() - $seconds;
        $removed = 0;

        foreach (glob(rtrim($this->directory, '/') . '/*.json') ?: [] as $file) {
            $modified = filemtime($file);

            if ($modified !== false && $modified < $cutoff && @unlink($file)) {
                ++$removed;
            }
        }

        return $removed;
    }

    /**
     * Map a session id to a path, refusing anything that is not a plain
     * hex token. This is the only thing standing between a crafted session
     * id and a path traversal, so it is a strict allowlist.
     */
    private function pathFor(string $id): ?string
    {
        if (preg_match('/^[a-f0-9]{32}$/', $id) !== 1) {
            return null;
        }

        return rtrim($this->directory, '/') . '/' . $id . '.json';
    }

    private function ensureDirectory(): void
    {
        if (!is_dir($this->directory) && !mkdir($this->directory, 0770, true) && !is_dir($this->directory)) {
            throw new \RuntimeException("Could not create state directory '{$this->directory}'.");
        }
    }
}
