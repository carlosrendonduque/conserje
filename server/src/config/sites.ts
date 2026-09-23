/**
 * Loads every site config once per cold start.
 *
 * Reading the directory rather than importing a generated module keeps the
 * promise the README makes: adding a client is dropping a JSON file in
 * `sites/`, not running a build step. `netlify.toml` ships that directory with
 * the function bundle via `included_files`.
 *
 * Finding it again at runtime takes more care than it looks. Unbundled -- the
 * dev server, the tests, the CLI scripts -- the directory sits at a fixed
 * offset from this file. Bundled by esbuild into a Netlify Function it does
 * not: `import.meta.dirname` then points at wherever the bundle landed, and
 * the included files sit relative to the deploy root instead. So the candidates
 * are tried in order and the first one that actually holds configs wins, with
 * the failure naming every path tried -- a deployment that cannot find its
 * tenants should say where it looked.
 *
 * A malformed config takes the whole service down at boot rather than failing
 * one request later: a tenant whose allowlist did not parse should never be
 * serving traffic.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError, siteFromJson, type SiteConfig } from './site.ts';

export interface SiteRepository {
  get(id: string): SiteConfig | undefined;
  ids(): string[];
}

function candidateDirectories(): string[] {
  const configured = process.env['CONSERJE_SITES_DIR'];

  if (typeof configured === 'string' && configured.trim() !== '') {
    return [resolve(configured)];
  }

  const here = dirname(fileURLToPath(import.meta.url));

  return [
    // Bundled: included_files are unpacked relative to the deploy root.
    resolve(process.cwd(), 'sites'),
    // Unbundled: src/config/ -> server/ -> repo root.
    resolve(here, '../../../sites'),
    // Bundled but with the working directory somewhere unexpected.
    resolve(here, 'sites'),
  ];
}

function isPopulatedDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).some((n) => n.endsWith('.json'));
  } catch {
    return false;
  }
}

export function loadSites(directory?: string): SiteRepository {
  const candidates = directory === undefined ? candidateDirectories() : [resolve(directory)];
  const dir = candidates.find(isPopulatedDirectory);

  if (dir === undefined) {
    throw new ConfigError(
      `No sites directory with any .json config. Looked in: ${candidates.join(', ')}. ` +
        'Set CONSERJE_SITES_DIR, or check included_files in netlify.toml.',
    );
  }

  const sites = new Map<string, SiteConfig>();

  for (const entry of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const path = join(dir, entry);
    let parsed: unknown;

    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new ConfigError(`Site config '${entry}' is not valid JSON.`, { cause });
    }

    const site = siteFromJson(parsed);
    const expected = `${site.id}.json`;

    // The filename is how a human finds the config for a site id; letting the
    // two drift turns every later lookup into a guess.
    if (entry !== expected) {
      throw new ConfigError(`Site config '${entry}' declares id '${site.id}'; rename it to '${expected}'.`);
    }

    sites.set(site.id, site);
  }

  return {
    get: (id) => sites.get(id),
    ids: () => [...sites.keys()],
  };
}
