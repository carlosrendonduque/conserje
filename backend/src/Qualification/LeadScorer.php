<?php

declare(strict_types=1);

namespace Conserje\Qualification;

use Conserje\Config\SiteConfig;

/**
 * Turns an extracted lead into a 0-100 score and a routing tier.
 *
 * Scoring lives on the server, not in the prompt. Two reasons: the same input
 * must always produce the same tier (a model asked for a number will drift),
 * and the weights are business rules that should be reviewable in a diff and
 * covered by tests rather than buried in prose.
 *
 * Weights: budget 45, timeline 30, contact reachability 15, context 10.
 */
final class LeadScorer
{
    private const URGENT_HINTS = [
        'asap', 'urgent', 'immediately', 'this week', 'right away', 'now',
        'ya', 'urgente', 'inmediato', 'esta semana', 'cuanto antes', 'de inmediato',
    ];

    private const SOON_HINTS = [
        'this month', 'next month', 'weeks', '30 days', 'quarter',
        'este mes', 'proximo mes', 'próximo mes', 'semanas', 'trimestre',
    ];

    private const VAGUE_HINTS = [
        'someday', 'exploring', 'just looking', 'no rush', 'not sure', 'eventually',
        'algun dia', 'algún día', 'explorando', 'solo mirando', 'sin prisa', 'no se', 'no sé',
    ];

    /** @param array<string,mixed> $toolInput */
    public function score(array $toolInput, SiteConfig $site): int
    {
        $score = 0;
        $score += $this->budgetPoints($toolInput['budgetBand'] ?? null, $site);
        $score += $this->timelinePoints($toolInput['timeline'] ?? null);
        $score += $this->contactPoints($toolInput);
        $score += $this->contextPoints($toolInput);

        return max(0, min(100, $score));
    }

    public function tier(int $score, SiteConfig $site): string
    {
        if ($score >= $site->hotScoreThreshold) {
            return Lead::TIER_HOT;
        }

        if ($score >= $site->warmScoreThreshold) {
            return Lead::TIER_WARM;
        }

        return Lead::TIER_COLD;
    }

    /**
     * Bands are ordered low-to-high in the site config, so position in that
     * list is the signal. An unrecognised band scores as if unstated.
     */
    private function budgetPoints(mixed $band, SiteConfig $site): int
    {
        if (!is_string($band)) {
            return 0;
        }

        $index = array_search($band, $site->budgetBands, true);

        if ($index === false) {
            return 0;
        }

        $bandCount = count($site->budgetBands);

        if ($bandCount === 1) {
            return 45;
        }

        return (int) round(45 * ($index / ($bandCount - 1)));
    }

    private function timelinePoints(mixed $timeline): int
    {
        if (!is_string($timeline) || trim($timeline) === '') {
            return 0;
        }

        $normalized = $this->normalize($timeline);

        if ($this->containsAny($normalized, self::VAGUE_HINTS)) {
            return 5;
        }

        if ($this->containsAny($normalized, self::URGENT_HINTS)) {
            return 30;
        }

        if ($this->containsAny($normalized, self::SOON_HINTS)) {
            return 20;
        }

        // Stated but unrecognised still beats silence.
        return 12;
    }

    /** @param array<string,mixed> $input */
    private function contactPoints(array $input): int
    {
        $email = $input['email'] ?? null;
        $hasEmail = is_string($email) && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
        $hasPhone = is_string($input['phone'] ?? null) && trim((string) $input['phone']) !== '';

        if ($hasEmail && $hasPhone) {
            return 15;
        }

        return $hasEmail || $hasPhone ? 10 : 0;
    }

    /** @param array<string,mixed> $input */
    private function contextPoints(array $input): int
    {
        $points = 0;

        if (is_string($input['company'] ?? null) && trim((string) $input['company']) !== '') {
            $points += 5;
        }

        $need = $input['need'] ?? null;

        // A specific brief is worth more than "I need a website".
        if (is_string($need) && mb_strlen(trim($need)) >= 40) {
            $points += 5;
        }

        return $points;
    }

    private function normalize(string $value): string
    {
        $lowered = mb_strtolower(trim($value));

        // Fold accents so the Spanish hint lists match unaccented input too.
        $folded = @iconv('UTF-8', 'ASCII//TRANSLIT', $lowered);

        return $folded === false ? $lowered : mb_strtolower($folded);
    }

    /** @param list<string> $needles */
    private function containsAny(string $haystack, array $needles): bool
    {
        foreach ($needles as $needle) {
            if (str_contains($haystack, $this->normalize($needle))) {
                return true;
            }
        }

        return false;
    }
}
