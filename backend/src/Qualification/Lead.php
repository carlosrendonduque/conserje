<?php

declare(strict_types=1);

namespace Conserje\Qualification;

/**
 * A lead as extracted by the model, plus the tier this server assigned it.
 *
 * Everything the model supplies is treated as untrusted text: it is validated
 * and length-capped on the way in, and the score is computed here rather than
 * asked for, so routing never depends on the model's arithmetic.
 */
final class Lead
{
    public const TIER_HOT = 'hot';
    public const TIER_WARM = 'warm';
    public const TIER_COLD = 'cold';

    private function __construct(
        public readonly ?string $name,
        public readonly ?string $email,
        public readonly ?string $phone,
        public readonly ?string $company,
        public readonly string $need,
        public readonly ?string $timeline,
        public readonly ?string $budgetBand,
        public readonly string $summary,
        public readonly int $score,
        public readonly string $tier,
    ) {
    }

    /**
     * Build from a tool-use payload.
     *
     * @param array<string,mixed> $input Raw tool input from the model.
     *
     * @throws \InvalidArgumentException when the payload has no usable need.
     */
    public static function fromToolInput(array $input, int $score, string $tier): self
    {
        $need = self::text($input, 'need', 600);

        if ($need === null) {
            throw new \InvalidArgumentException('A lead must describe what the visitor needs.');
        }

        $email = self::text($input, 'email', 254);

        // A syntactically invalid address is dropped rather than propagated;
        // downstream automation would bounce on it anyway.
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $email = null;
        }

        return new self(
            name: self::text($input, 'name', 120),
            email: $email,
            phone: self::text($input, 'phone', 40),
            company: self::text($input, 'company', 160),
            need: $need,
            timeline: self::text($input, 'timeline', 80),
            budgetBand: self::text($input, 'budgetBand', 80),
            summary: self::text($input, 'summary', 1000) ?? $need,
            score: $score,
            tier: $tier,
        );
    }

    public function hasContact(): bool
    {
        return $this->email !== null || $this->phone !== null;
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'company' => $this->company,
            'need' => $this->need,
            'timeline' => $this->timeline,
            'budgetBand' => $this->budgetBand,
            'summary' => $this->summary,
            'score' => $this->score,
            'tier' => $this->tier,
        ];
    }

    /** @param array<string,mixed> $input */
    private static function text(array $input, string $key, int $maxLength): ?string
    {
        $value = $input[$key] ?? null;

        if (!is_string($value)) {
            return null;
        }

        // Collapse whitespace so a model that pads with newlines does not
        // produce ragged CRM records.
        $value = trim((string) preg_replace('/\s+/u', ' ', $value));

        if ($value === '') {
            return null;
        }

        return mb_substr($value, 0, $maxLength);
    }
}
