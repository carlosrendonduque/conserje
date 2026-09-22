#!/usr/bin/env node
/**
 * Static server for the demo page.
 *
 * Binds to 8080 because that is one of the origins carlos-portfolio.json
 * allows -- open the demo on any other port and the backend will correctly
 * refuse the call, which is the allowlist doing its job, not a bug.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const requested = new URL(req.url, `http://localhost:${port}`).pathname;
  const relative = requested === '/' ? '/demo/index.html' : requested;

  // normalize() collapses '..' before the join, so a crafted path cannot
  // escape the widget directory.
  const target = join(here, normalize(relative));

  if (!target.startsWith(here)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Demo at http://localhost:${port}/`);
  console.log('Backend expected at http://localhost:8000/chat');
});
