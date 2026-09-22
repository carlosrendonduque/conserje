<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Qualification\Lead;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class LeadTest extends TestCase
{
    #[Test]
    public function it_requires_a_need(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        Lead::fromToolInput(['email' => 'a@b.test'], 50, Lead::TIER_WARM);
    }

    #[Test]
    public function it_collapses_whitespace_so_records_stay_clean(): void
    {
        $lead = Lead::fromToolInput(
            ['need' => "  a new\n\n   website   for  my shop \n", 'summary' => 'x'],
            10,
            Lead::TIER_COLD,
        );

        self::assertSame('a new website for my shop', $lead->need);
    }

    #[Test]
    public function it_drops_a_malformed_email_rather_than_passing_it_downstream(): void
    {
        $lead = Lead::fromToolInput(
            ['need' => 'something', 'email' => 'definitely not an address'],
            10,
            Lead::TIER_COLD,
        );

        self::assertNull($lead->email);
        self::assertFalse($lead->hasContact());
    }

    #[Test]
    public function it_caps_field_lengths(): void
    {
        $lead = Lead::fromToolInput(
            ['need' => str_repeat('x', 5000), 'summary' => str_repeat('y', 5000)],
            10,
            Lead::TIER_COLD,
        );

        self::assertSame(600, mb_strlen($lead->need));
        self::assertSame(1000, mb_strlen($lead->summary));
    }

    #[Test]
    public function it_falls_back_to_the_need_when_no_summary_is_supplied(): void
    {
        $lead = Lead::fromToolInput(['need' => 'a landing page'], 10, Lead::TIER_COLD);

        self::assertSame('a landing page', $lead->summary);
    }

    #[Test]
    public function non_string_values_become_null(): void
    {
        $lead = Lead::fromToolInput(
            ['need' => 'x', 'name' => ['nested'], 'phone' => 42, 'company' => null],
            10,
            Lead::TIER_COLD,
        );

        self::assertNull($lead->name);
        self::assertNull($lead->phone);
        self::assertNull($lead->company);
    }

    #[Test]
    public function the_serialised_shape_is_stable(): void
    {
        // n8n workflows bind to these keys; changing them is a breaking change.
        $lead = Lead::fromToolInput(['need' => 'x'], 55, Lead::TIER_WARM);

        self::assertSame(
            ['name', 'email', 'phone', 'company', 'need', 'timeline', 'budgetBand', 'summary', 'score', 'tier'],
            array_keys($lead->toArray()),
        );
    }
}
