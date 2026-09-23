/**
 * Print the embed snippet for a site.
 *
 * The greeting, title and locale all come from the site config, so the snippet
 * and the backend can never disagree about them. Paste the output into the
 * host page.
 *
 *   node --experimental-strip-types bin/print-embed.ts carlosrendon
 *   node --experimental-strip-types bin/print-embed.ts carlosrendon --endpoint=https://api.example.com/chat
 */

import { loadSites } from '../src/config/sites.ts';

const args = process.argv.slice(2);
const siteId = args[0];

if (siteId === undefined || siteId.startsWith('--')) {
  console.error('Usage: print-embed.ts <site-id> [--endpoint=URL] [--script=URL]');
  process.exit(1);
}

const flag = (name: string, fallback: string): string => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));

  return match === undefined ? fallback : match.slice(prefix.length);
};

const endpoint = flag('endpoint', 'https://api.example.com/chat');
const scriptUrl = flag('script', 'https://cdn.example.com/conserje.js');

const site = loadSites().get(siteId);

if (site === undefined) {
  console.error(`No site config with id '${siteId}'.`);
  process.exit(1);
}

/** The greeting is free text from a config file and lands in an attribute. */
const attr = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

console.log(`<script src="${attr(scriptUrl)}"
        data-endpoint="${attr(endpoint)}"
        data-site="${attr(site.id)}"
        data-title="${attr(site.name)}"
        data-greeting="${attr(site.greeting)}"
        data-locale="${attr(site.locale)}"
        defer></script>
`);

console.log('Allowed origins for this site:');

for (const origin of site.allowedOrigins) {
  console.log(`  ${origin}`);
}

console.log('\nThe page must be served from one of those, or the browser will block the call.');
