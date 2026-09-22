<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Qualification\PromptBuilder;
use Conserje\Tests\Support\SiteFactory;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class PromptBuilderTest extends TestCase
{
    private PromptBuilder $builder;

    protected function setUp(): void
    {
        $this->builder = new PromptBuilder();
    }

    #[Test]
    public function the_rendered_prefix_is_byte_stable(): void
    {
        // This is what makes the cache breakpoint worth having: if the same
        // site ever rendered two different prefixes, every conversation would
        // pay full price for the system prompt and tool definition.
        $site = SiteFactory::make();

        self::assertSame($this->builder->systemPrompt($site), $this->builder->systemPrompt($site));
        self::assertSame(
            json_encode($this->builder->leadTool($site), JSON_THROW_ON_ERROR),
            json_encode($this->builder->leadTool($site), JSON_THROW_ON_ERROR),
        );
    }

    #[Test]
    public function the_system_prompt_carries_the_sites_own_context(): void
    {
        $site = SiteFactory::make([
            'name' => 'Acme Dental',
            'businessContext' => 'Acme fits crowns and does not do orthodontics.',
            'collect' => ['Which tooth hurts'],
        ]);

        $prompt = $this->builder->systemPrompt($site);

        self::assertStringContainsString('Acme Dental', $prompt);
        self::assertStringContainsString('does not do orthodontics', $prompt);
        self::assertStringContainsString('- Which tooth hurts', $prompt);
    }

    #[Test]
    public function the_system_prompt_lists_every_budget_band(): void
    {
        $site = SiteFactory::make(['budgetBands' => ['tiny', 'medium', 'enormous']]);
        $prompt = $this->builder->systemPrompt($site);

        foreach (['tiny', 'medium', 'enormous'] as $band) {
            self::assertStringContainsString("- {$band}", $prompt);
        }
    }

    #[Test]
    public function the_system_prompt_frames_visitor_text_as_data(): void
    {
        $prompt = $this->builder->systemPrompt(SiteFactory::make());

        self::assertStringContainsString('never instruction to', $prompt);
    }

    #[Test]
    public function the_tool_schema_is_strict_and_closed(): void
    {
        $tool = $this->builder->leadTool(SiteFactory::make());

        self::assertSame(PromptBuilder::TOOL_NAME, $tool['name']);
        self::assertTrue($tool['strict']);
        self::assertFalse($tool['inputSchema']['additionalProperties']);
    }

    #[Test]
    public function every_property_is_required_as_strict_mode_demands(): void
    {
        $schema = $this->builder->leadTool(SiteFactory::make())['inputSchema'];

        self::assertSame(
            array_keys($schema['properties']),
            $schema['required'],
            'strict mode rejects a schema whose required list omits a property',
        );
    }

    #[Test]
    public function the_budget_enum_offers_the_sites_bands_plus_null(): void
    {
        $site = SiteFactory::make(['budgetBands' => ['a', 'b']]);
        $schema = $this->builder->leadTool($site)['inputSchema'];

        self::assertSame(['a', 'b', null], $schema['properties']['budgetBand']['enum']);
    }

    #[Test]
    public function only_the_need_and_summary_are_non_nullable(): void
    {
        $properties = $this->builder->leadTool(SiteFactory::make())['inputSchema']['properties'];

        self::assertSame('string', $properties['need']['type']);
        self::assertSame('string', $properties['summary']['type']);
        self::assertSame(['string', 'null'], $properties['email']['type']);
        self::assertSame(['string', 'null'], $properties['name']['type']);
    }
}
