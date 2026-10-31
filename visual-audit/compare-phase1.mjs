#!/usr/bin/env node
/**
 * visual-audit/compare-phase1.mjs — before/after sheets for the Phase 1 pass.
 *
 * Reads the two labelled capture runs (before-phase1/ and after-phase1/) and
 * composes one comparison sheet per page and viewport. Each sheet has the first
 * screen at a readable size and the page below it, scaled — so the composition
 * change can be judged both close up and as a rhythm.
 *
 * Images are never stretched: width is fixed, height follows the source aspect
 * ratio. The "page" row is cropped to a fixed height for the tall mobile pages
 * only, and says so in its caption.
 *
 *   AUDIT_OUT=before-phase1 … node visual-audit/capture.mjs
 *   AUDIT_OUT=after-phase1  … node visual-audit/capture.mjs
 *   node visual-audit/compare-phase1.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) { console.error('No Chrome found.'); process.exit(2); }

const before = JSON.parse(readFileSync(join(HERE, 'before-phase1', 'manifest.json'), 'utf8'));
const after = JSON.parse(readFileSync(join(HERE, 'after-phase1', 'manifest.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHEETS = [
  { page: 'Homepage', device: 'desktop', key: 'home-desktop', colWidth: 520, heroWidth: 700 },
  { page: 'Homepage', device: 'mobile', key: 'home-mobile', colWidth: 300, heroWidth: 360, crop: 3000 },
  { page: 'About', device: 'desktop', key: 'about-desktop', colWidth: 520, heroWidth: 700 },
  { page: 'About', device: 'mobile', key: 'about-mobile', colWidth: 300, heroWidth: 360, crop: 3000 },
  { page: 'Coaching', device: 'desktop', key: 'coaching-desktop', colWidth: 440, heroWidth: 700 },
  { page: 'Coaching', device: 'mobile', key: 'coaching-mobile', colWidth: 300, heroWidth: 360, crop: 3000 },
  { page: 'Coaching pilot', device: 'desktop', key: 'pilot-desktop', colWidth: 520, heroWidth: 700 },
];

const find = (manifest, page, device, kind, section) => manifest.screenshots.find((s) =>
  s.page === page && s.device === device && s.kind === kind && (section ? s.section === section : true));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function figure(dir, shot, width, caption, crop) {
  if (!shot) return '';
  const wrapStyle = crop ? ` style="max-height:${crop}px;overflow:hidden"` : '';
  return `
      <figure class="shot" style="width:${width}px">
        <div class="crop"${wrapStyle}><img src="../${dir}/${shot.file}" alt="${esc(caption)}" /></div>
        <figcaption>${esc(caption)}</figcaption>
      </figure>`;
}

function sheetHtml(cfg) {
  const rows = [
    {
      title: 'First screen',
      html: ['before-phase1', 'after-phase1'].map((dir) => {
        const m = dir === 'before-phase1' ? before : after;
        const hero = find(m, cfg.page, cfg.device, 'section', 'hero');
        return figure(dir, hero, cfg.heroWidth, `${dir === 'before-phase1' ? 'Before' : 'After'} — first screen`);
      }).join(''),
    },
    {
      title: cfg.crop
        ? `Page, scaled to ${cfg.colWidth}px wide (first ${cfg.crop}px shown)`
        : `Full page, scaled to ${cfg.colWidth}px wide`,
      html: ['before-phase1', 'after-phase1'].map((dir) => {
        const m = dir === 'before-phase1' ? before : after;
        const full = find(m, cfg.page, cfg.device, 'full-page');
        const label = `${dir === 'before-phase1' ? 'Before' : 'After'} — ${full.imageSize.width}×${full.imageSize.height}px`;
        return figure(dir, full, cfg.colWidth, label, cfg.crop);
      }).join(''),
    },
  ].map((row) => `
    <section class="row">
      <h2>${esc(row.title)}</h2>
      <div class="strip">${row.html}</div>
    </section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(cfg.page)} ${cfg.device} before/after</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 26px 30px 40px; background: #fff;
         font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #1c1f24; }
  h1 { font-size: 19px; margin: 0 0 4px; font-weight: 600; }
  .note { font-size: 12.5px; color: #5c636f; margin: 0 0 22px; }
  h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .1em;
       color: #5c636f; margin: 26px 0 10px; }
  .strip { display: flex; gap: 18px; align-items: flex-start; }
  .shot { margin: 0; flex: 0 0 auto; }
  .shot img { display: block; width: 100%; height: auto; border: 1px solid #d8d3c6; }
  .crop { position: relative; }
  .crop::after { content: ""; position: absolute; inset: auto 0 0 0; height: 40px;
                 background: linear-gradient(to bottom, rgba(255,255,255,0), #fff); }
  figcaption { font-size: 11px; color: #4a4f58; margin-top: 6px; line-height: 1.4; }
</style>
</head>
<body>
  <h1>${esc(cfg.page)} — ${esc(cfg.device)} — before / after Phase 1</h1>
  <p class="note">Same browser, viewport, device scale factor, colour scheme and reduced-motion setting for both captures. Full-resolution files: before-phase1/ and after-phase1/.</p>
  ${rows}
</body>
</html>`;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  const file = join(HERE, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4420, r));

const port = 9970 + Math.floor(Math.random() * 20);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--force-color-profile=srgb', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/compare-phase1-${port}`, 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch { /* not up yet */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl.replace(/^http/, 'ws'));
await new Promise((res) => ws.addEventListener('open', res));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

mkdirSync(join(HERE, 'contact-sheets'), { recursive: true });
const made = [];

for (const cfg of SHEETS) {
  writeFileSync(join(HERE, 'contact-sheets', `compare-${cfg.key}.html`), sheetHtml(cfg));
  const width = Math.max(cfg.colWidth, cfg.heroWidth) * 2 + 18 + 70;
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:4420/contact-sheets/compare-${cfg.key}.html` });
  await sleep(300);
  await send('Runtime.evaluate', {
    expression: 'Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => true)',
    awaitPromise: true,
  });
  const measured = await send('Runtime.evaluate', {
    expression: '({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })',
    returnByValue: true,
  });
  const size = measured.result.value;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
  });
  const out = join(HERE, 'contact-sheets', `compare-${cfg.key}.png`);
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  made.push({ file: `contact-sheets/compare-${cfg.key}.png`, page: cfg.page, device: cfg.device, width: Math.ceil(size.width), height: Math.ceil(size.height) });
  console.log(`  compare-${cfg.key}.png  ${Math.ceil(size.width)}×${Math.ceil(size.height)}`);
}

writeFileSync(join(HERE, 'contact-sheets', 'compare-index.json'), JSON.stringify(made, null, 2) + '\n');
ws.close();
chrome.kill();
server.close();
process.exit(0);
