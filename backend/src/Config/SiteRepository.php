<?php

declare(strict_types=1);

namespace Conserje\Config;

/**
 * Loads site configs from a directory of JSON files, one per site.
 *
 * Configs are read once per process and memoized. The site id is taken from
 * the file contents, not the filename, so a mismatch is caught rather than
 * silently serving the wrong tenant.
 */
final class SiteRepository
{
    /** @var array<string,SiteConfig> */
    private array $cache = [];

    private bool $loaded = false;

    public function __construct(private readonly string $directory)
    {
    }

    /** @throws ConfigException */
    public function get(string $siteId): SiteConfig
    {
        $this->load();

        if (!isset($this->cache[$siteId])) {
            throw new ConfigException("Unknown site '{$siteId}'.");
        }

        return $this->cache[$siteId];
    }

    public function has(string $siteId): bool
    {
        $this->load();

        return isset($this->cache[$siteId]);
    }

    /**
     * @return list<string>
     *
     * @throws ConfigException
     */
    public function ids(): array
    {
        $this->load();

        return array_keys($this->cache);
    }

    /** @throws ConfigException */
    private function load(): void
    {
        if ($this->loaded) {
            return;
        }

        if (!is_dir($this->directory)) {
            throw new ConfigException("Sites directory '{$this->directory}' does not exist.");
        }

        $files = glob(rtrim($this->directory, '/') . '/*.json');

        foreach ($files ?: [] as $file) {
            $contents = file_get_contents($file);

            if ($contents === false) {
                throw new ConfigException("Could not read site config '{$file}'.");
            }

            try {
                /** @var array<string,mixed> $decoded */
                $decoded = json_decode($contents, true, 32, JSON_THROW_ON_ERROR);
            } catch (\JsonException $e) {
                throw new ConfigException("Invalid JSON in '{$file}': {$e->getMessage()}", 0, $e);
            }

            $config = SiteConfig::fromArray($decoded);
            $expected = basename($file, '.json');

            if ($config->id !== $expected) {
                throw new ConfigException("Site id '{$config->id}' does not match filename '{$expected}.json'.");
            }

            $this->cache[$config->id] = $config;
        }

        $this->loaded = true;
    }
}
