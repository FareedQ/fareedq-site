#!/usr/bin/env node
/**
 * visual-audit/contact-sheets.mjs — compose the comparison sheets.
 *
 * Each sheet is an HTML page (a grid of <img> at a fixed width, with labels)
 * rendered by Chrome and captured to PNG, so no image library is needed. Images
 * are scaled proportionally — width is fixed per column, height follows — so
 * nothing is stretched or cropped.
 *
 *   node visual-audit/contact-sheets.mjs
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
if (!CHROME) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(2); }

const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const full = (device) => manifest.screenshots.filter((s) => s.kind === 'full-page' && s.device === device);
const sections = (page, device) => manifest.screenshots
  .filter((s) => s.kind === 'section' && s.device === device && s.page === page);

const byPage = (device) => Object.fromEntries(full(device).map((s) => [s.page, s]));

const SHEETS = [
  {
    name: 'A-desktop-overview',
    title: 'All nine pages — desktop 1440×900 — full-page captures, scaled to 300px wide',
    note: 'Reading order matches the site: homepage, coaching, philosophy overview, the three pillars, about, pilot, form.',
    rows: [{ width: 300, items: full('desktop').map((s) => ({ file: s.file, label: `${s.page}\n${s.route} · ${s.imageSize.width}×${s.imageSize.height}` })) }],
  },
  {
    name: 'B-mobile-overview',
    title: 'All nine pages — mobile 390×844 — full-page captures, scaled to 190px wide',
    note: 'Same pages, same order. Mobile pages are tall; compare overall rhythm and section sequence rather than fine detail.',
    rows: [{ width: 190, items: full('mobile').map((s) => ({ file: s.file, label: `${s.page}\n${s.route} · ${s.imageSize.width}×${s.imageSize.height}` })) }],
  },
  {
    name: 'C-homepage-detail',
    title: 'Homepage — major sections at desktop (top row) and mobile (bottom row)',
    note: 'Viewport-sized captures, one per section, in page order.',
    rows: [
      { width: 380, label: 'Desktop 1440×900', items: sections('Homepage', 'desktop').map((s) => ({ file: s.file, label: s.section })) },
      { width: 200, label: 'Mobile 390×844', items: sections('Homepage', 'mobile').map((s) => ({ file: s.file, label: s.section })) },
    ],
  },
  {
    name: 'D-coaching-pilot-detail',
    title: 'Coaching and pilot — major sections, desktop and mobile',
    note: 'Row 1–2: coaching at desktop and mobile. Row 3–4: the pilot page at desktop and mobile.',
    rows: [
      { width: 300, label: 'Coaching — desktop 1440×900', items: sections('Coaching', 'desktop').map((s) => ({ file: s.file, label: s.section })) },
      { width: 170, label: 'Coaching — mobile 390×844', items: sections('Coaching', 'mobile').map((s) => ({ file: s.file, label: s.section })) },
      { width: 300, label: 'Pilot — desktop 1440×900', items: sections('Coaching pilot', 'desktop').map((s) => ({ file: s.file, label: s.section })) },
      { width: 170, label: 'Pilot — mobile 390×844', items: sections('Coaching pilot', 'mobile').map((s) => ({ file: s.file, label: s.section })) },
    ],
  },
  {
    name: 'E-form-validation',
    title: 'Expression-of-interest form — empty submit, client-side validation',
    note: 'Error state produced locally by a blocked submit. No request is made and nothing is sent.',
    rows: [
      { width: 520, label: 'Desktop 1440×900', items: manifest.screenshots.filter((s) => s.section === 'validation-errors' && s.device === 'desktop').map((s) => ({ file: s.file, label: 'validation errors — desktop' })) },
      { width: 320, label: 'Mobile 390×844', items: manifest.screenshots.filter((s) => s.section === 'validation-errors' && s.device === 'mobile').map((s) => ({ file: s.file, label: 'validation errors — mobile' })) },
    ],
  },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sheetHtml(sheet) {
  const rows = sheet.rows.map((row) => {
    const items = row.items.map((item) => `
        <figure class="shot" style="width:${row.width}px">
          <img src="../${item.file}" alt="${esc(item.label)}" loading="eager" />
          <figcaption>${esc(item.label).replace(/\n/g, '<br />')}</figcaption>
        </figure>`).join('');
    return `
      <section class="row">
        ${row.label ? `<h2>${esc(row.label)}</h2>` : ''}
        <div class="strip">${items}</div>
      </section>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(sheet.name)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px 32px 40px; background: #ffffff;
         font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #1c1f24; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
  .note { font-size: 13px; color: #5c636f; margin: 0 0 26px; max-width: 1100px; line-height: 1.5; }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em;
       color: #5c636f; margin: 30px 0 12px; }
  .row { margin-top: 10px; }
  .strip { display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 16px; }
  .shot { margin: 0; flex: 0 0 auto; }
  .shot img { display: block; width: 100%; height: auto;
              border: 1px solid #d8d3c6; background: #fff; }
  figcaption { font-size: 11px; line-height: 1.45; color: #4a4f58; margin-top: 6px; }
</style>
</head>
<body>
  <h1>${esc(sheet.title)}</h1>
  <p class="note">${esc(sheet.note)}</p>
  ${rows}
</body>
</html>`;
}

/* ---- serve visual-audit/ so the sheet can load its images ------------------ */
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  const file = join(HERE, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4410, r));

/* ---- Chrome --------------------------------------------------------------- */
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--force-color-profile=srgb',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/contact-sheets-${port}`,
  'about:blank',
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
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }],
});

mkdirSync(join(HERE, 'contact-sheets'), { recursive: true });

const made = [];
for (const sheet of SHEETS) {
  if (!sheet.rows.some((r) => r.items.length)) {
    console.log(`  skipped ${sheet.name}: no images`);
    continue;
  }
  const htmlPath = join(HERE, 'contact-sheets', `${sheet.name}.html`);
  writeFileSync(htmlPath, sheetHtml(sheet));

  const widest = Math.max(...sheet.rows.map((row) => row.items.length * (row.width + 16) + 64));
  await send('Emulation.setDeviceMetricsOverride', { width: widest, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:4410/contact-sheets/${sheet.name}.html` });
  await sleep(250);
  await send('Runtime.evaluate', {
    expression: `Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => true)`,
    awaitPromise: true,
  });

  /* Measure in the page: getLayoutMetrics does not always report a content size
     for a short document, and the sheet is short. */
  const measured = await send('Runtime.evaluate', {
    expression: `({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`,
    returnByValue: true,
  });
  const size = measured.result.value;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
  });
  const out = join(HERE, 'contact-sheets', `${sheet.name}.png`);
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  made.push({ file: `contact-sheets/${sheet.name}.png`, width: Math.ceil(size.width), height: Math.ceil(size.height) });
  console.log(`  ${sheet.name}.png  ${Math.ceil(size.width)}×${Math.ceil(size.height)}`);
}

writeFileSync(join(HERE, 'contact-sheets', 'index.json'), JSON.stringify(made, null, 2) + '\n');

/* Record the sheets in the manifest so one file describes the whole package. */
const manifestPath = join(HERE, 'manifest.json');
const current = JSON.parse(readFileSync(manifestPath, 'utf8'));
current.contactSheets = made.map((m) => ({
  file: m.file,
  imageSize: { width: m.width, height: m.height },
  sheets: SHEETS.find((s) => m.file.includes(s.name))?.title || '',
}));
writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n');

ws.close();
chrome.kill();
server.close();
process.exit(0);
