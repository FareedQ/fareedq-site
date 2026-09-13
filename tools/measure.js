#!/usr/bin/env node
/**
 * tools/measure.js — check the real reading measure of built pages.
 *
 * The CSS `ch` unit is the width of the glyph "0", which in Georgia is 0.614em
 * while the average lowercase letter is ~0.41em. A stylesheet that says
 * `max-width: 66ch` therefore renders about 98 characters per line. This tool
 * reports the number that actually matters: characters per rendered line.
 *
 *   node build.mjs
 *   python3 -m http.server 4321 --directory dist &
 *   node tools/measure.js http://127.0.0.1:4321 /framework/regulation/ ...
 *
 * Requires a local Chrome for the DevTools Protocol. There is no npm
 * dependency: this speaks the protocol over Node's built-in WebSocket.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(2);
}

const base = process.argv[2] || 'http://127.0.0.1:4321';
const paths = process.argv.slice(3);
if (!paths.length) {
  console.error('Usage: node tools/measure.js <baseUrl> <path> [path...]');
  process.exit(2);
}

const PORT = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/fareedq-measure-${PORT}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

/* Target's WebSocket URL is http(s); Node's WebSocket wants ws(s). */
const toWs = (u) => u.replace(/^http/, 'ws');

const EXPR = `(() => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('p, li, dd, blockquote')) {
    if (el.closest('.hp, .fw-nav, .toc, .doorway, .masthead, .footer, .process')) continue;
    const text = el.textContent.replace(/\\s+/g, ' ').trim();
    if (text.length < 200) continue;
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter(r => r.width > 20);
    if (rects.length < 2) continue;
    const key = cs.fontSize + cs.fontFamily;
    const cpl = Math.round(text.length / rects.length);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        font: cs.fontFamily.split(',')[0],
        size: cs.fontSize,
        charsPerLine: cpl,
        weight: text.length,
        width: Math.round(el.getBoundingClientRect().width),
      });
    }
  }
  return JSON.stringify(out);
})()`;

const TARGET_MAX = 72;  // beyond this, long-form reading gets tiring

let failed = false;

try {
  for (let i = 0; i < 80; i++) {
    try { await cdp('/json/version'); break; } catch { await sleep(300); }
  }

  const target = await cdp('/json/new?about:blank', 'PUT');
  const ws = new WebSocket(toWs(target.webSocketDebuggerUrl));
  await new Promise((resolve) => ws.addEventListener('open', resolve));

  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const p of paths) {
    await send('Page.navigate', { url: base + p });
    await sleep(1800);
    const evaluated = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
    const rows = JSON.parse(evaluated.result?.result?.value || '[]');
    if (!rows.length) { console.log(`   ${p}: no long-form text found`); continue; }

    /* Report the dominant body size (the one with the most text); the lede and
       caption sizes are secondary and naturally differ a little. */
    const body = rows.reduce((best, r) => (!best || r.weight > best.weight ? r : best), null);
    const flag = body.charsPerLine > TARGET_MAX ? '✗' : '✓';
    if (body.charsPerLine > TARGET_MAX) failed = true;
    console.log(`  ${flag} ${p}  ${body.charsPerLine} chars/line  (${body.font} ${body.size}, box ${body.width}px)`);
  }

  ws.close();
} finally {
  chrome.kill();
}

process.exit(failed ? 1 : 0);
