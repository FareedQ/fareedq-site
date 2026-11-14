#!/usr/bin/env node
/**
 * tools/images.mjs — regenerate the site's responsive photography.
 *
 * The site itself has no image pipeline: `public/assets/*.webp` are pre-rendered
 * and committed, and `build.mjs` copies `public/` verbatim. This script is the
 * thing that makes them, from the originals in `assets-src/`.
 *
 *   node tools/images.mjs
 *
 * It runs headless Chromium (already a dev dependency, for the visual audit) and
 * uses the canvas encoder — WebP for the page, JPEG for social cards, because
 * several scrapers still ignore WebP. Downscaling is done in halving steps so a
 * 4036px original does not alias into a 480px derivative.
 *
 * Development only. It is not part of the build, and the originals are never
 * modified or downscaled in place.
 */

import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SRC = join(ROOT, 'assets-src');
const OUT = join(ROOT, 'public', 'assets');

/* One entry per photograph. `widths` are the widths that get rendered; every
   derivative keeps the source's aspect ratio. */
const PHOTOS = [
  {
    name: 'fareed-headshot',
    file: 'Headshot.png',
    widths: [480, 800, 1200],
    quality: 0.84,
  },
  {
    /* Portrait, 2:3. The container takes this ratio from the markup's
       width/height, so nothing has to change in CSS when the photograph does. */
    name: 'fareed-outdoors',
    file: 'Outdoors.jpeg',
    widths: [480, 800, 1200],
    quality: 0.8,
  },
  {
    /* Social card for the About page. JPEG, because link scrapers are uneven
       about WebP. Square, matching the portrait. */
    name: 'og-fareed',
    file: 'Headshot.png',
    widths: [1200],
    quality: 0.86,
    format: 'jpeg',
  },
];

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not resolvable from here */ }
  const local = join(ROOT, 'node_modules', 'playwright', 'index.mjs');
  if (existsSync(local)) return await import(pathToFileURL(local).href);
  console.error('Playwright is not installed in this project (node_modules/playwright).');
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');

const dataUrl = (file) => {
  const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(join(SRC, file)).toString('base64')}`;
};

/** Halving downscale, then a final draw at the exact target width. */
async function render(src, width, quality, format) {
  return page.evaluate(async ({ src, width, quality, format }) => {
    const img = new Image();
    img.src = src;
    await img.decode();

    const ratio = img.naturalHeight / img.naturalWidth;
    let cur = document.createElement('canvas');
    cur.width = img.naturalWidth;
    cur.height = img.naturalHeight;
    let ctx = cur.getContext('2d');
    ctx.drawImage(img, 0, 0);

    let w = cur.width;
    while (w / 2 > width) {
      const next = document.createElement('canvas');
      next.width = Math.round(w / 2);
      next.height = Math.round((w / 2) * ratio);
      const nctx = next.getContext('2d');
      nctx.imageSmoothingEnabled = true;
      nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
      w = cur.width;
    }

    const out = document.createElement('canvas');
    out.width = width;
    out.height = Math.round(width * ratio);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(cur, 0, 0, out.width, out.height);

    return {
      data: out.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/webp', quality),
      width: out.width,
      height: out.height,
      sourceWidth: img.naturalWidth,
      sourceHeight: img.naturalHeight,
    };
  }, { src, width, quality, format });
}

let total = 0;
for (const photo of PHOTOS) {
  const src = dataUrl(photo.file);
  const format = photo.format || 'webp';
  console.log(`\n${photo.name}  (from assets-src/${photo.file})`);
  for (const width of photo.widths) {
    const { data, width: w, height: h, sourceWidth, sourceHeight } = await render(src, width, photo.quality, format);
    const ext = format === 'jpeg' ? 'jpg' : 'webp';
    const file = join(OUT, `${photo.name}-${width}.${ext}`);
    const buf = Buffer.from(data.split(',')[1], 'base64');
    writeFileSync(file, buf);
    total += buf.length;
    const kb = (buf.length / 1024).toFixed(0);
    console.log(`  ${photo.name}-${width}.${ext}  ${w}x${h}  ${kb} kB  (source ${sourceWidth}x${sourceHeight})`);
  }
}
await browser.close();
console.log(`\n✓ ${total / 1024 > 1024 ? (total / 1048576).toFixed(2) + ' MB' : (total / 1024).toFixed(0) + ' kB'} written into public/assets/`);
