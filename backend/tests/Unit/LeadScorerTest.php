<?php

declare(strict_types=1);

namespace Conserje\Tests\Unit;

use Conserje\Qualification\Lead;
use Conserje\Qualification\LeadScorer;
use Conserje\Tests\Support\SiteFactory;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class LeadScorerTest extends TestCase
{
    private LeadScorer $scorer;

    protected function setUp(): void
    {
        $this->scorer = new LeadScorer();
    }

    #[Test]
    public function budget_scales_with_the_configured_band_order(): void
    {
        $site = SiteFactory::make();

        $lowest = $this->scorer->score(['need' => 'x', 'budgetBand' => 'under-5k'], $site);
        $highest = $this->scorer->score(['need' => 'x', 'budgetBand' => 'over-40k'], $site);
        $middle = $this->scorer->score(['need' => 'x', 'budgetBand' => '5k-15k'], $site);

        self::assertSame(0, $lowest);
        self::assertSame(45, $highest);
        self::assertGreaterThan($lowest, $middle);
        self::assertLessThan($highest, $middle);
    }

    #[Test]
    public function an_unknown_budget_band_scores_as_unstated(): void
    {
        // A model that invents a label must not be able to inflate a lead.
        $site = SiteFactory::make();

        self::assertSame(
            $this->scorer->score(['need' => 'x'], $site),
            $this->scorer->score(['need' => 'x', 'budgetBand' => 'enormous'], $site),
        );
    }

    #[Test]
    public function urgency_outranks_vagueness_in_both_languages(): void
    {
        $site = SiteFactory::make();

        $urgentEn = $this->scorer->score(['need' => 'x', 'timeline' => 'ASAP'], $site);
        $urgentEs = $this->scorer->score(['need' => 'x', 'timeline' => 'urgente'], $site);
        $vague = $this->scorer->score(['need' => 'x', 'timeline' => 'just looking'], $site);
        $vagueEs = $this->scorer->score(['need' => 'x', 'timeline' => 'sin prisa'], $site);

        self::assertSame($urgentEn, $urgentEs, 'accent folding should make these equivalent');
        self::assertSame($vague, $vagueEs);
        self::assertGreaterThan($vague, $urgentEn);
    }

    #[Test]
    public function reachability_is_worth_more_than_a_single_channel(): void
    {
        $site = SiteFactory::make();

        $none = $this->scorer->score(['need' => 'x'], $site);
        $email = $this->scorer->score(['need' => 'x', 'email' => 'a@b.test'], $site);
        $both = $this->scorer->score(['need' => 'x', 'email' => 'a@b.test', 'phone' => '+57 300'], $site);

        self::assertSame(0, $none);
        self::assertSame(10, $email);
        self::assertSame(15, $both);
    }

    #[Test]
    public function a_malformed_email_earns_no_contact_points(): void
    {
        $site = SiteFactory::make();

        self::assertSame(0, $this->scorer->score(['need' => 'x', 'email' => 'not-an-address'], $site));
    }

    #[Test]
    public function the_score_is_bounded_and_deterministic(): void
    {
        $site = SiteFactory::make();
        $input = [
            'need' => str_repeat('a detailed brief about the project ', 5),
            'email' => 'a@b.test',
            'phone' => '+57 300 000 0000',
            'company' => 'Acme',
            'timeline' => 'this week',
            'budgetBand' => 'over-40k',
        ];

        $first = $this->scorer->score($input, $site);

        self::assertSame(100, $first);
        self::assertSame($first, $this->scorer->score($input, $site));
    }

    #[Test]
    public function tiers_follow_the_sites_thresholds(): void
    {
        $site = SiteFactory::make(['hotScoreThreshold' => 70, 'warmScoreThreshold' => 40]);

        self::assertSame(Lead::TIER_HOT, $this->scorer->tier(70, $site));
        self::assertSame(Lead::TIER_WARM, $this->scorer->tier(69, $site));
        self::assertSame(Lead::TIER_WARM, $this->scorer->tier(40, $site));
        self::assertSame(Lead::TIER_COLD, $this->scorer->tier(39, $site));
    }

    #[Test]
    public function a_single_band_site_does_not_divide_by_zero(): void
    {
        $site = SiteFactory::make(['budgetBands' => ['any']]);

        self::assertSame(45, $this->scorer->score(['need' => 'x', 'budgetBand' => 'any'], $site));
    }
}
