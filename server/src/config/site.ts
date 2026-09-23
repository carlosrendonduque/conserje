/**
 * Immutable configuration for one host site.
 *
 * A "site" is a tenant: one landing page, one client, one set of qualification
 * rules. Everything that differs between deployments lives here so that adding
 * a client is a JSON file, not a code change.
 */

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface SiteConfig {
  readonly id: string;
  readonly name: string;
  readonly locale: string;
  readonly model: string;
  /** Exact origins allowed to embed the widget. */
  readonly allowedOrigins: readonly string[];
  readonly greeting: string;
  readonly businessContext: string;
  /** Facts the assistant must gather before closing. */
  readonly collect: readonly string[];
  /** Ordered low-to-high; the index feeds lead scoring. */
  readonly budgetBands: readonly string[];
  readonly maxTurns: number;
  readonly maxMessageChars: number;
  readonly requestsPerHour: number;
  readonly webhookUrlEnv: string;
  readonly hotScoreThreshold: number;
  readonly warmScoreThreshold: number;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Build from a decoded JSON config, applying defaults and rejecting anything
 * malformed. Fail loudly here rather than at request time.
 */
export function siteFromJson(raw: unknown): SiteConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('A site config must be a JSON object.');
  }

  const record = raw as Record<string, unknown>;
  const id = requireString(record, 'id');

  if (!ID_PATTERN.test(id)) {
    throw new ConfigError(`Site id '${id}' must be lowercase alphanumeric with dashes.`);
  }

  const allowedOrigins = requireList(record, 'allowedOrigins', id);

  if (allowedOrigins.length === 0) {
    throw new ConfigError(`Site '${id}' must declare at least one allowed origin.`);
  }

  for (const origin of allowedOrigins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new ConfigError(`Site '${id}' has a malformed origin: '${origin}'.`);
    }

    if (parsed.protocol === '' || parsed.hostname === '') {
      throw new ConfigError(`Site '${id}' has a malformed origin: '${origin}'.`);
    }

    // Browsers never send a trailing slash in Origin, so one here would make
    // the entry unmatchable and the allowlist quietly shorter than it looks.
    if (origin.endsWith('/')) {
      throw new ConfigError(`Origin '${origin}' must not end in a slash; browsers never send one.`);
    }
  }

  const budgetBands = requireList(record, 'budgetBands', id);

  if (budgetBands.length === 0) {
    throw new ConfigError(`Site '${id}' must declare at least one budget band.`);
  }

  const hotScoreThreshold = intOr(record, 'hotScoreThreshold', 70);
  const warmScoreThreshold = intOr(record, 'warmScoreThreshold', 40);

  if (warmScoreThreshold >= hotScoreThreshold) {
    throw new ConfigError(`Site '${id}': warmScoreThreshold must be below hotScoreThreshold.`);
  }

  return {
    id,
    name: requireString(record, 'name'),
    locale: stringOr(record, 'locale', 'en'),
    // Defaults to the current flagship. Override per site to trade quality
    // for cost -- see docs/ARCHITECTURE.md.
    model: stringOr(record, 'model', 'claude-opus-5'),
    allowedOrigins,
    greeting: requireString(record, 'greeting'),
    businessContext: requireString(record, 'businessContext'),
    collect: requireList(record, 'collect', id),
    budgetBands,
    maxTurns: intOr(record, 'maxTurns', 14),
    maxMessageChars: intOr(record, 'maxMessageChars', 1200),
    requestsPerHour: intOr(record, 'requestsPerHour', 60),
    webhookUrlEnv: requireString(record, 'webhookUrlEnv'),
    hotScoreThreshold,
    warmScoreThreshold,
  };
}

export function allowsOrigin(site: SiteConfig, origin: string | null): boolean {
  // Exact match only. Wildcards and suffix matching are how allowlists
  // quietly stop being allowlists.
  return origin !== null && site.allowedOrigins.includes(origin);
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`Missing or empty required string '${key}'.`);
  }

  return value;
}

function requireList(raw: Record<string, unknown>, key: string, siteId: string): string[] {
  const value = raw[key];

  if (!Array.isArray(value)) {
    throw new ConfigError(`Site '${siteId}': '${key}' must be an array of strings.`);
  }

  return value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ConfigError(`Site '${siteId}': '${key}' must contain non-empty strings only.`);
    }

    return item;
  });
}

function stringOr(raw: Record<string, unknown>, key: string, fallback: string): string {
  const value = raw[key];

  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function intOr(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];

  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
