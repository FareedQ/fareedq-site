#!/usr/bin/env node
/**
 * visual-audit/capture.mjs — screenshot every primary page of FareedQ.com.
 *
 * Development tooling for the visual audit, not part of the site. It speaks the
 * Chrome DevTools Protocol using Node's built-in WebSocket and fetch, so there is
 * nothing to install.
 *
 *   1. node build.mjs
 *   2. node tools/csp-preview.mjs 4400        # serves dist/ with the real CSP
 *   3. node visual-audit/capture.mjs          # writes full-pages/, sections/, manifest.json
 *
 * Determinism: device scale factor is 1, colour scheme is light, animations and
 * transitions are disabled through the site's own `prefers-reduced-motion` rule
 * (emulated media — no styles are injected), and every page is scrolled end to
 * end before capture so fonts, images and layout are settled.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:4400';

/* Optional overrides, so the same script can capture a labelled subset into its
   own directory (used for the before/after pairs):
     AUDIT_OUT=before-phase1  AUDIT_PAGES=home,about  AUDIT_DEVICES=desktop,mobile */
const OUT_DIR = process.env.AUDIT_OUT ? join(HERE, process.env.AUDIT_OUT) : HERE;
const ONLY_PAGES = process.env.AUDIT_PAGES ? process.env.AUDIT_PAGES.split(',').map((s) => s.trim()).filter(Boolean) : null;
const ONLY_DEVICES = process.env.AUDIT_DEVICES ? process.env.AUDIT_DEVICES.split(',').map((s) => s.trim()).filter(Boolean) : null;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}

const VIEWPORTS = [
  { device: 'desktop', width: 1440, height: 900, mobile: false },
  { device: 'tablet', width: 768, height: 1024, mobile: false },
  { device: 'mobile', width: 390, height: 844, mobile: true },
];

/* Routes confirmed from build.mjs and the generated dist/ tree. */
const PAGES = [
  { key: 'home', route: '/', label: 'Homepage' },
  { key: 'coaching', route: '/coaching/', label: 'Coaching' },
  { key: 'framework', route: '/framework/', label: 'Philosophy overview' },
  { key: 'regulation', route: '/framework/regulation/', label: 'Nervous system regulation' },
  { key: 'mvl', route: '/framework/minimal-viable-life/', label: 'Minimal viable life' },
  { key: 'participation', route: '/framework/participation/', label: 'Participation' },
  { key: 'about', route: '/about/', label: 'About' },
  { key: 'pilot', route: '/work-with-me/', label: 'Coaching pilot' },
  { key: 'onboarding', route: '/onboarding/', label: 'Expression of interest form' },
];

const PAGES_USED = ONLY_PAGES ? PAGES.filter((p) => ONLY_PAGES.includes(p.key)) : PAGES;
const VIEWPORTS_USED = ONLY_DEVICES ? VIEWPORTS.filter((v) => ONLY_DEVICES.includes(v.device)) : VIEWPORTS;
if (!PAGES_USED.length) { console.error('AUDIT_PAGES matched nothing'); process.exit(2); }
if (!VIEWPORTS_USED.length) { console.error('AUDIT_DEVICES matched nothing'); process.exit(2); }

const section = (sel, name) => ({ sel, name });

const SECTIONS = {
  home: [
    section('.hero', 'hero'),
    section('section[aria-labelledby="who-title"]', 'who-this-may-be-for'),
    section('section[aria-labelledby="framework-title"]', 'three-pillars'),
    section('section[aria-labelledby="work-title"]', 'coaching-explanation'),
    section('section[aria-labelledby="about-title"]', 'meet-the-coach'),
    section('section[aria-labelledby="pilot-title"]', 'pilot-and-pricing'),
    section('section[aria-labelledby="invite-title"]', 'closing-cta'),
  ],
  coaching: [
    section('main > section:first-of-type', 'hero'),
    section('section[aria-labelledby="what-title"]', 'what-life-coaching-is'),
    section('section[aria-labelledby="first-title"]', 'first-session'),
    section('section[aria-labelledby="package-title"]', 'six-sessions'),
    section('section[aria-labelledby="faq-title"]', 'faq'),
    section('section[aria-labelledby="start-title"]', 'closing-cta'),
  ],
  pilot: [
    section('main > section:first-of-type', 'hero'),
    section('section[aria-labelledby="options-title"]', 'pricing'),
    section('section[aria-labelledby="pilot-title"]', 'pilot-explanation'),
    section('section[aria-labelledby="terms-title"]', 'terms'),
    section('#inquiry', 'closing-cta'),
  ],
  onboarding: [
    section('section[aria-labelledby="form-title"]', 'form'),
    section('#consent', 'acknowledgement'),
  ],
  framework: [section('main > section:first-of-type', 'hero'), section('.diagram--pillars', 'pillars-diagram')],
  regulation: [section('main > section:first-of-type', 'hero'), section('.diagram--zones', 'zones-diagram')],
  mvl: [section('main > section:first-of-type', 'hero')],
  participation: [section('main > section:first-of-type', 'hero')],
  about: [section('main > section:first-of-type', 'hero')],
};

/* Sections are desktop + mobile only; tablet is covered by the full pages. */
const SECTION_DEVICES = new Set(['desktop', 'mobile']);
const SHOT_SECTIONS = process.env.AUDIT_SECTIONS !== '0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const port = 9700 + Math.floor(Math.random() * 200);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-color-profile=srgb', '--font-render-hinting=none',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/visual-audit-${port}`,
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
  if (!target) throw new Error('Chrome did not expose a debugging target');

  const ws = new WebSocket(target.webSocketDebuggerUrl.replace(/^http/, 'ws'));
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let id = 0;
  const pending = new Map();
  const events = { console: [], log: [] };
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      events.console.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      events.log.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim());
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  /* CSP violations are reported to the page; capture them from the first frame. */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations.push(e.violatedDirective + ' ' + (e.blockedURI || ''));
      });
      window.__jsErrors = [];
      window.addEventListener('error', (e) => window.__jsErrors.push(String(e.message)));
      window.addEventListener('unhandledrejection', (e) => window.__jsErrors.push(String(e.reason)));`,
  });

  await send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-color-scheme', value: 'light' },
    ],
  });

  return { send, events, chrome, ws };
}

function pngMeta(buf) {
  /* Width and height live at bytes 16..24 of a PNG IHDR chunk. */
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

async function main() {
  const { send, events, chrome, ws } = await connect();

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
    return r.result.value;
  };

  const setViewport = (vp) => send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile,
  });

  const settle = async () => {
    /* Fonts, images, two frames, plus a full scroll pass so anything that only
       paints in view has painted before the full-page capture. */
    await evaluate(`new Promise((resolve) => {
      const go = () => Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        ...[...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => {
          i.addEventListener('load', r, { once: true });
          i.addEventListener('error', r, { once: true });
        })),
      ]).then(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
    })`);
    await evaluate(`(async () => {
      const step = window.innerHeight;
      const height = document.documentElement.scrollHeight;
      for (let y = 0; y < height; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(r));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => requestAnimationFrame(r));
      return true;
    })()`);
    await sleep(120);
  };

  const diagnostics = () => evaluate(`(() => {
    const de = document.documentElement;
    /* Chrome does not enumerate @font-face entries in FontFaceSet here, so the
       reliable test is check(): does the family resolve for the weights used. */
    const fontChecks = {
      archivoBold: document.fonts ? document.fonts.check('600 1rem Archivo') : false,
      archivoRegular: document.fonts ? document.fonts.check('400 1rem Archivo') : false,
      georgia: document.fonts ? document.fonts.check('400 1rem Georgia') : false,
    };
    return JSON.stringify({
      title: document.title,
      h1: (document.querySelector('h1') || {}).textContent || '',
      h1Count: document.querySelectorAll('h1').length,
      scrollHeight: de.scrollHeight,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflow: de.scrollWidth > de.clientWidth + 1,
      fontChecks,
      images: [...document.images].map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })),
      csp: window.__cspViolations || [],
      jsErrors: window.__jsErrors || [],
    });
  })()`);

  const records = [];
  const issues = [];
  const capturedAt = new Date().toISOString();

  const save = async (path, name) => {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const buf = Buffer.from(shot.data, 'base64');
    const file = join(OUT_DIR, path, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    return { file: `${path}/${name}`, meta: pngMeta(buf) };
  };

  for (const vp of VIEWPORTS_USED) {
    await setViewport(vp);
    for (const page of PAGES_USED) {
      const url = BASE + page.route;
      events.console.length = 0;
      events.log.length = 0;
      await send('Page.navigate', { url });
      await sleep(150);
      await settle();

      const diag = JSON.parse(await diagnostics());
      const warnings = [];
      if (diag.overflow) warnings.push(`horizontal overflow: ${diag.scrollWidth} > ${diag.clientWidth}`);
      if (diag.h1Count !== 1) warnings.push(`${diag.h1Count} h1 elements`);
      const broken = diag.images.filter((i) => !i.ok);
      if (broken.length) warnings.push(`broken images: ${broken.map((b) => b.src).join(', ')}`);
      if (!diag.fontChecks.archivoBold) warnings.push('Archivo (600) does not resolve — webfont may not have loaded');
      if (diag.csp.length) warnings.push(`CSP violations: ${diag.csp.join('; ')}`);
      if (diag.jsErrors.length) warnings.push(`JS errors: ${diag.jsErrors.join('; ')}`);
      if (events.console.length) warnings.push(`console errors: ${events.console.join('; ')}`);
      if (events.log.length) warnings.push(`log errors: ${events.log.join('; ')}`);
      if (diag.scrollHeight > 16000) warnings.push(`page height ${diag.scrollHeight}px approaches the capture limit`);

      /* Full page. */
      const metrics = await send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      const clip = {
        x: 0, y: 0,
        width: Math.max(vp.width, Math.ceil(size.width)),
        height: Math.ceil(size.height),
        scale: 1,
      };
      const full = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, clip,
      });
      const fullBuf = Buffer.from(full.data, 'base64');
      const fullName = `${page.key}-${vp.device}-full.png`;
      const fullPath = join('full-pages', vp.device, fullName);
      mkdirSync(join(OUT_DIR, 'full-pages', vp.device), { recursive: true });
      writeFileSync(join(OUT_DIR, fullPath), fullBuf);
      const fullMeta = pngMeta(fullBuf);
      if (fullMeta.height < clip.height - 2) {
        warnings.push(`full-page capture is ${fullMeta.height}px for a ${clip.height}px document`);
      }

      records.push({
        file: fullPath,
        kind: 'full-page',
        page: page.label,
        route: page.route,
        device: vp.device,
        viewport: { width: vp.width, height: vp.height },
        imageSize: { width: fullMeta.width, height: fullMeta.height },
        documentHeight: diag.scrollHeight,
        bytes: fullMeta.bytes,
        pageTitle: diag.title,
        capturedAt,
        warnings,
      });
      if (warnings.length) issues.push({ file: fullPath, warnings });

      /* Sections. */
      if (SHOT_SECTIONS && SECTION_DEVICES.has(vp.device) && SECTIONS[page.key]) {
        for (const s of SECTIONS[page.key]) {
          const moved = await evaluate(`(() => {
            const el = document.querySelector(${JSON.stringify(s.sel)});
            if (!el) return null;
            const head = document.querySelector('.masthead');
            const offset = (head ? head.getBoundingClientRect().height : 0) + 8;
            const top = el.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo(0, Math.max(0, top));
            return Math.round(window.scrollY);
          })()`);
          if (moved === null) {
            issues.push({ file: `${page.key}-${vp.device}-${s.name}`, warnings: [`selector not found: ${s.sel}`] });
            continue;
          }
          await sleep(140);
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          const buf = Buffer.from(shot.data, 'base64');
          const name = `${page.key}-${vp.device}-${s.name}.png`;
          const rel = join('sections', vp.device, name);
          mkdirSync(join(OUT_DIR, 'sections', vp.device), { recursive: true });
          writeFileSync(join(OUT_DIR, rel), buf);
          const meta = pngMeta(buf);
          records.push({
            file: rel,
            kind: 'section',
            page: page.label,
            route: page.route,
            device: vp.device,
            viewport: { width: vp.width, height: vp.height },
            imageSize: { width: meta.width, height: meta.height },
            bytes: meta.bytes,
            section: s.name,
            selector: s.sel,
            scrollY: moved,
            pageTitle: diag.title,
            capturedAt,
            warnings: [],
          });
        }
      }

      process.stdout.write(`  ${vp.device.padEnd(8)} ${page.route.padEnd(34)} ${String(diag.scrollHeight).padStart(6)}px ${warnings.length ? '⚠' : '✓'}\n`);
    }
  }

  /* Validation state of the enquiry form: client-side only, nothing is sent. */
  await setViewport(VIEWPORTS[0]);
  for (const vp of VIEWPORTS.filter((v) => SECTION_DEVICES.has(v.device))) {
    await setViewport(vp);
    await send('Page.navigate', { url: `${BASE}/onboarding/` });
    await sleep(150);
    await settle();
    const triggered = await evaluate(`(() => {
      const form = document.querySelector('[data-inquiry-form]');
      if (!form) return false;
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return true;
    })()`);
    if (!triggered) {
      issues.push({ file: 'onboarding-validation', warnings: ['form not found'] });
      continue;
    }
    await sleep(220);
    const scrolled = await evaluate(`(() => {
      const form = document.querySelector('[data-inquiry-form]');
      const head = document.querySelector('.masthead');
      const offset = (head ? head.getBoundingClientRect().height : 0) + 8;
      const top = form.getBoundingClientRect().top + window.scrollY - offset - 40;
      window.scrollTo(0, Math.max(0, top));
      return Math.round(window.scrollY);
    })()`);
    await sleep(140);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    const name = `onboarding-${vp.device}-validation-errors.png`;
    const rel = join('sections', vp.device, name);
    writeFileSync(join(OUT_DIR, rel), buf);
    const meta = pngMeta(buf);
    records.push({
      file: rel,
      kind: 'section',
      page: 'Expression of interest form',
      route: '/onboarding/',
      device: vp.device,
      viewport: { width: vp.width, height: vp.height },
      imageSize: { width: meta.width, height: meta.height },
      bytes: meta.bytes,
      section: 'validation-errors',
      note: 'Error state produced by an empty client-side submit; no request is made and nothing is sent.',
      scrollY: scrolled,
      capturedAt,
      warnings: [],
    });
  }

  const manifest = {
    site: 'FareedQ.com (local build)',
    baseUrl: BASE,
    capturedAt,
    browser: 'Google Chrome (headless, DevTools Protocol)',
    configuration: {
      deviceScaleFactor: 1,
      colourScheme: 'light',
      reducedMotion: 'prefers-reduced-motion: reduce (emulated; no styles injected)',
      fullPageCapture: 'captureBeyondViewport with a clip to the CSS content size',
    },
    viewports: VIEWPORTS_USED.map(({ device, width, height }) => ({ device, width, height })),
    pages: PAGES_USED.map((p) => ({ page: p.label, route: p.route })),
    counts: {
      fullPage: records.filter((r) => r.kind === 'full-page').length,
      sections: records.filter((r) => r.kind === 'section').length,
    },
    issues,
    screenshots: records,
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\n${records.filter((r) => r.kind === 'full-page').length} full-page + ${records.filter((r) => r.kind === 'section').length} section screenshots`);
  console.log(issues.length ? `${issues.length} capture warning(s) — see manifest.json` : 'no capture warnings');

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('capture failed:', err.message);
  process.exit(1);
});
