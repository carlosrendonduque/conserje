/**
 * A lead as extracted by the model, plus the tier this server assigned it.
 *
 * Everything the model supplies is treated as untrusted text: it is validated
 * and length-capped on the way in, and the score is computed here rather than
 * asked for, so routing never depends on the model's arithmetic.
 */

export const TIER_HOT = 'hot';
export const TIER_WARM = 'warm';
export const TIER_COLD = 'cold';

export type Tier = typeof TIER_HOT | typeof TIER_WARM | typeof TIER_COLD;

export interface Lead {
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly need: string;
  readonly timeline: string | null;
  readonly budgetBand: string | null;
  readonly summary: string;
  readonly score: number;
  readonly tier: Tier;
}

export class UnusableLeadError extends Error {
  override readonly name = 'UnusableLeadError';
}

/**
 * Deliberately not RFC 5322. The job here is to drop what downstream
 * automation would bounce on, not to adjudicate exotic addresses: one @,
 * something either side, a dot in the domain, no whitespace.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Code points, not UTF-16 units, so an emoji counts as one character. */
export function charLength(value: string): number {
  return [...value].length;
}

/**
 * Build from a tool-use payload.
 *
 * @throws UnusableLeadError when the payload has no usable need.
 */
export function leadFromToolInput(
  input: Record<string, unknown>,
  score: number,
  tier: Tier,
): Lead {
  const need = text(input, 'need', 600);

  if (need === null) {
    throw new UnusableLeadError('A lead must describe what the visitor needs.');
  }

  const rawEmail = text(input, 'email', 254);

  // A syntactically invalid address is dropped rather than propagated;
  // downstream automation would bounce on it anyway.
  const email = rawEmail !== null && isEmail(rawEmail) ? rawEmail : null;

  return {
    name: text(input, 'name', 120),
    email,
    phone: text(input, 'phone', 40),
    company: text(input, 'company', 160),
    need,
    timeline: text(input, 'timeline', 80),
    budgetBand: text(input, 'budgetBand', 80),
    summary: text(input, 'summary', 1000) ?? need,
    score,
    tier,
  };
}

export function hasContact(lead: Lead): boolean {
  return lead.email !== null || lead.phone !== null;
}

/** Trim, reject non-strings and blanks, and cap length in code points. */
function text(input: Record<string, unknown>, key: string, maxChars: number): string | null {
  const value = input[key];

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  return charLength(trimmed) > maxChars ? [...trimmed].slice(0, maxChars).join('') : trimmed;
}
