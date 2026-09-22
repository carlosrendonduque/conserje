#!/usr/bin/env node
/**
 * Bundles the widget into a single dependency-free file.
 *
 * The stylesheet is inlined into the JS placeholder so the embed stays one
 * script tag with no second request and no flash of unstyled chat. The
 * minifier is intentionally conservative -- it only strips comments and
 * collapses whitespace outside of string literals, because a widget that
 * breaks under minification is worse than one that ships a few KB larger.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');
const outDir = join(here, 'dist');

const css = readFileSync(join(srcDir, 'conserje.css'), 'utf8');
const js = readFileSync(join(srcDir, 'conserje.js'), 'utf8');

if (!js.includes('__CONSERJE_STYLES__')) {
  console.error('conserje.js no longer contains the __CONSERJE_STYLES__ placeholder.');
  process.exit(1);
}

/** Strip CSS comments and collapse runs of whitespace. */
function minifyCss(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

const bundled = js.replace(
  "'__CONSERJE_STYLES__'",
  JSON.stringify(minifyCss(css)),
);

mkdirSync(outDir, { recursive: true });

const banner = '/* Conserje widget -- https://github.com/carlosrendonduque/conserje -- MIT */\n';
const outFile = join(outDir, 'conserje.js');

writeFileSync(outFile, banner + bundled, 'utf8');

const kb = (Buffer.byteLength(banner + bundled) / 1024).toFixed(1);
console.log(`Built dist/conserje.js (${kb} KB)`);
