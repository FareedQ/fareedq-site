#!/usr/bin/env node
/**
 * visual-audit/validate.mjs — confirm every captured PNG is a real image.
 *
 * Checks, for each file in manifest.json:
 *   - the file exists and is a PNG with the dimensions the manifest recorded;
 *   - it is not blank: sampled pixels show more than a couple of colours and a
 *     real luminance spread;
 *   - the bottom of the image is not a uniform void (the usual symptom of a
 *     browser that silently capped a very tall capture).
 *
 * Uses Chrome to decode the PNGs — no image library is installed. Chrome is
 * started with --allow-file-access-from-files so canvas can read local files.
 *
 *   node visual-audit/validate.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}

/* Optional argument: a manifest path relative to this directory, so the labelled
   runs (before-phase1/, after-phase1/) can be validated with the same script. */
const MANIFEST = process.argv[2] || 'manifest.json';
const manifest = JSON.parse(readFileSync(join(HERE, MANIFEST), 'utf8'));
const OUT_JSON = join(dirname(join(HERE, MANIFEST)), 'validation.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/visual-audit-validate-${port}`,
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
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
await send('Page.enable');
await send('Runtime.enable');

/* Load the page from the same file:// origin as the images: an about:blank page
   taints a canvas that has drawn a local file, and getImageData then throws. */
await send('Page.navigate', { url: 'file://' + join(HERE, '_blank.html') });
await sleep(300);

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error(`${d.text}: ${d.exception?.description || d.exception?.value || ''}`);
  }
  return r.result.result.value;
};

/* Load an image, draw it small, and summarise its pixels. */
const measure = (fileUrl) => evaluate(`(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(fileUrl)};
  await img.decode();
  const w = Math.min(240, img.naturalWidth);
  const h = Math.max(1, Math.round(img.naturalHeight * (w / img.naturalWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  const band = (y0, y1) => {
    const d = ctx.getImageData(0, y0, w, Math.max(1, y1 - y0)).data;
    let sum = 0, sumSq = 0, n = 0;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += lum; sumSq += lum * lum; n++;
      colours.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
    }
    const mean = sum / n;
    return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), colours: colours.size };
  };

  const whole = band(0, h);
  const bottom = band(Math.max(0, h - Math.max(2, Math.round(h * 0.02))), h);
  return JSON.stringify({
    width: img.naturalWidth,
    height: img.naturalHeight,
    mean: Math.round(whole.mean),
    sd: Math.round(whole.sd * 10) / 10,
    colours: whole.colours,
    bottom: { mean: Math.round(bottom.mean), sd: Math.round(bottom.sd * 10) / 10, colours: bottom.colours },
  });
})()`);

const results = [];
const failures = [];
let checked = 0;

for (const shot of manifest.screenshots) {
  /* Paths in a labelled run's manifest are relative to that run's directory. */
  const abs = join(dirname(join(HERE, MANIFEST)), shot.file);
  const record = { file: shot.file, kind: shot.kind, device: shot.device, page: shot.page };
  if (!existsSync(abs)) {
    record.error = 'missing file';
    failures.push(record);
    results.push(record);
    continue;
  }
  record.bytes = statSync(abs).size;
  const info = JSON.parse(await measure('file://' + abs));
  record.image = { width: info.width, height: info.height };
  record.pixels = { mean: info.mean, sd: info.sd, colours: info.colours, bottom: info.bottom };

  const problems = [];
  if (info.width !== shot.imageSize.width || info.height !== shot.imageSize.height) {
    problems.push(`dimensions ${info.width}x${info.height} differ from manifest ${shot.imageSize.width}x${shot.imageSize.height}`);
  }
  if (info.colours < 3) problems.push(`only ${info.colours} distinct colours — possibly blank`);
  if (info.sd < 1) problems.push('no luminance variation — possibly blank');
  /* A flat bottom edge is normal here — footers and bands are solid colour — so
     truncation is detected by comparing the capture to the document height. */
  if (shot.kind === 'full-page' && shot.documentHeight
      && Math.abs(info.height - shot.documentHeight) > 2) {
    problems.push(`capture height ${info.height}px but document is ${shot.documentHeight}px`);
  }
  record.problems = problems;
  if (problems.length) failures.push(record);
  results.push(record);
  checked++;
  if (checked % 20 === 0) process.stdout.write(`  checked ${checked}/${manifest.screenshots.length}\n`);
}

const report = {
  checkedAt: new Date().toISOString(),
  total: manifest.screenshots.length,
  checked,
  failures: failures.length,
  results,
};
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');

console.log(`\n${checked}/${manifest.screenshots.length} images readable; ${failures.length} problem(s)`);
for (const f of failures) console.log(`  ✗ ${f.file}: ${(f.problems || [f.error]).join('; ')}`);

ws.close();
chrome.kill();
process.exit(failures.length ? 1 : 0);
