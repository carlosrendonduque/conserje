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

/**
 * Where this site's notifications go.
 *
 * These live in the site config rather than the automation's environment for
 * two reasons. They are per-client data, and per-client data is what
 * `sites/*.json` is for -- adding a client should stay a config file, not a
 * config file plus four environment variables on a shared n8n. And n8n Cloud
 * blocks `$env` in Code nodes and puts Variables behind a paid plan, so a
 * workflow there cannot read an environment at all; travelling inside the
 * payload is the one channel that works everywhere.
 *
 * None of these is a credential. The bot token, the SMTP password and the
 * Google OAuth grant stay in n8n, where a credential cannot be read back out.
 * A chat id or a sheet id only says where to deliver, never how to authorise.
 */
export interface NotifyTargets {
  /** Telegram chat that receives hot and warm alerts. */
  readonly telegramChatId: string | null;
  /** From address on outbound mail. */
  readonly fromEmail: string | null;
  /** Booking link offered to hot leads. */
  readonly bookingUrl: string | null;
  /** Google Sheet used as the lead log. */
  readonly sheetId: string | null;
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
  readonly notify: NotifyTargets;
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
    notify: notifyFrom(record['notify']),
  };
}

/** Absent or malformed entries become null: a missing target is not an error. */
function notifyFrom(raw: unknown): NotifyTargets {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const read = (key: string): string | null => {
    const value = record[key];

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  return {
    telegramChatId: read('telegramChatId'),
    fromEmail: read('fromEmail'),
    bookingUrl: read('bookingUrl'),
    sheetId: read('sheetId'),
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
