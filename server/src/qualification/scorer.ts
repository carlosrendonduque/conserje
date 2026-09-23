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

import type { SiteConfig } from '../config/site.ts';
import { charLength, isEmail, TIER_COLD, TIER_HOT, TIER_WARM, type Tier } from './lead.ts';

const URGENT_HINTS = [
  'asap', 'urgent', 'immediately', 'this week', 'right away', 'now',
  'ya', 'urgente', 'inmediato', 'esta semana', 'cuanto antes', 'de inmediato',
];

const SOON_HINTS = [
  'this month', 'next month', 'weeks', '30 days', 'quarter',
  'este mes', 'proximo mes', 'próximo mes', 'semanas', 'trimestre',
];

const VAGUE_HINTS = [
  'someday', 'exploring', 'just looking', 'no rush', 'not sure', 'eventually',
  'algun dia', 'algún día', 'explorando', 'solo mirando', 'sin prisa', 'no se', 'no sé',
];

export function score(toolInput: Record<string, unknown>, site: SiteConfig): number {
  const total =
    budgetPoints(toolInput['budgetBand'], site) +
    timelinePoints(toolInput['timeline']) +
    contactPoints(toolInput) +
    contextPoints(toolInput);

  return Math.max(0, Math.min(100, total));
}

export function tierFor(value: number, site: SiteConfig): Tier {
  if (value >= site.hotScoreThreshold) {
    return TIER_HOT;
  }

  return value >= site.warmScoreThreshold ? TIER_WARM : TIER_COLD;
}

/**
 * Bands are ordered low-to-high in the site config, so position in that list
 * is the signal. An unrecognised band scores as if unstated.
 */
function budgetPoints(band: unknown, site: SiteConfig): number {
  if (typeof band !== 'string') {
    return 0;
  }

  const index = site.budgetBands.indexOf(band);

  if (index === -1) {
    return 0;
  }

  if (site.budgetBands.length === 1) {
    return 45;
  }

  return Math.round(45 * (index / (site.budgetBands.length - 1)));
}

function timelinePoints(timeline: unknown): number {
  if (typeof timeline !== 'string' || timeline.trim() === '') {
    return 0;
  }

  const normalized = normalize(timeline);

  if (containsAny(normalized, VAGUE_HINTS)) {
    return 5;
  }

  if (containsAny(normalized, URGENT_HINTS)) {
    return 30;
  }

  if (containsAny(normalized, SOON_HINTS)) {
    return 20;
  }

  // Stated but unrecognised still beats silence.
  return 12;
}

function contactPoints(input: Record<string, unknown>): number {
  const email = input['email'];
  const phone = input['phone'];
  const hasEmail = typeof email === 'string' && isEmail(email.trim());
  const hasPhone = typeof phone === 'string' && phone.trim() !== '';

  if (hasEmail && hasPhone) {
    return 15;
  }

  return hasEmail || hasPhone ? 10 : 0;
}

function contextPoints(input: Record<string, unknown>): number {
  let points = 0;

  const company = input['company'];

  if (typeof company === 'string' && company.trim() !== '') {
    points += 5;
  }

  const need = input['need'];

  // A specific brief is worth more than "I need a website".
  if (typeof need === 'string' && charLength(need.trim()) >= 40) {
    points += 5;
  }

  return points;
}

/** Lowercase and strip accents, so the Spanish hints match unaccented input. */
function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(normalize(needle)));
}
