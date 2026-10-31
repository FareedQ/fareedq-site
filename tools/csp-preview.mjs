#!/usr/bin/env node
/**
 * tools/csp-preview.mjs — serve dist/ with the real Content-Security-Policy.
 *
 * The site ships a strict CSP in the generated `_headers` file (Cloudflare Pages
 * applies it in production). A plain static server does not send it, so a page
 * can look fine locally and then fail in production — which is exactly how the
 * inline `style` attributes this site used to carry went unnoticed.
 *
 *   node build.mjs
 *   node tools/csp-preview.mjs            # http://127.0.0.1:4400
 *   node tools/csp-preview.mjs 5000       # or another port
 *
 * Then, in a browser, watch the console: a blocked style or script reports a
 * `securitypolicyviolation`. There is no dependency here — Node's http and fs
 * are enough, and nothing about this file is part of the built site.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.argv[2]) || 4400;

const headersFile = join(DIST, '_headers');
if (!existsSync(headersFile)) {
  console.error('No dist/_headers — run `node build.mjs` first.');
  process.exit(1);
}

/* Parse the site-wide block of _headers, which Cloudflare applies to every
   path. The per-path blocks below it are only caching hints. */
const siteWide = readFileSync(headersFile, 'utf8')
  .split('\n\n')
  .find((block) => block.trim().startsWith('/*'));
const rules = Object.fromEntries(
  siteWide.split('\n').slice(1)
    .map((line) => line.match(/^\s*([^:]+):\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1].trim(), m[2].trim()])
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

createServer((req, res) => {
  let file = join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  for (const [name, value] of Object.entries(rules)) res.setHeader(name, value);
  if (!existsSync(file)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', TYPES['.html']);
    res.end(readFileSync(join(DIST, '404.html')));
    return;
  }
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(PORT, () => {
  console.log(`serving dist/ with ${rules['Content-Security-Policy'] ? 'the site CSP' : 'no CSP'} on http://127.0.0.1:${PORT}`);
});
