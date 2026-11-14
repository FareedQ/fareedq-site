#!/usr/bin/env node
/**
 * tools/check-ui.mjs — behavioural checks for the redesigned pages.
 *
 * Not a screenshot tool. It asserts the things measurements and screenshots are
 * bad at: that the mobile navigation actually opens and closes, that the
 * consultation CTA is the visually dominant navigation item, that focus rings
 * exist, that nothing overflows at the breakpoints the site supports, and that
 * the homepage still gets a visitor to a call to action without scrolling.
 *
 *   node tools/csp-preview.mjs 4400 &
 *   node tools/check-ui.mjs http://127.0.0.1:4400
 *
 * Development only, like the rest of tools/. Not part of the site.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = (process.argv[2] || 'http://127.0.0.1:4400').replace(/\/$/, '');

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const local = join(process.cwd(), 'node_modules', 'playwright', 'index.mjs');
  if (existsSync(local)) return await import(pathToFileURL(local).href);
  console.error('Playwright is not installed in this project.');
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const goto = async (route) => {
  await page.goto(BASE + route, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
};

/* ------------------------------------------------------------------ nav --- */

const NAV_LABELS = ['Coaching', 'About Me', 'FAQ', 'Philosophy'];
const CTA_LABEL = 'Book an Initial Consultation';

await goto('/');
notes.push(`nav: ${(await page.$$eval('.nav__link', (els) => els.map((e) => e.textContent.trim()))).join(' | ')}`);

const navLabels = await page.$$eval('.nav__link', (els) => els.map((e) => e.textContent.trim()));
if (JSON.stringify(navLabels) !== JSON.stringify(NAV_LABELS)) {
  fail(`nav links are ${JSON.stringify(navLabels)}, expected ${JSON.stringify(NAV_LABELS)}`);
}
const ctaText = await page.$eval('.nav__cta', (e) => e.textContent.trim());
if (ctaText !== CTA_LABEL) fail(`nav CTA reads "${ctaText}", expected "${CTA_LABEL}"`);
const ctaHref = await page.$eval('.nav__cta', (e) => e.getAttribute('href'));
if (ctaHref !== '/consultation/') fail(`nav CTA points at ${ctaHref}`);

/* The CTA has to look like the CTA: a filled surface, not another text link. */
const [ctaStyle, linkStyle] = await page.evaluate(() => {
  const bg = (el) => getComputedStyle(el).backgroundColor;
  return [
    { bg: bg(document.querySelector('.nav__cta')), weight: getComputedStyle(document.querySelector('.nav__cta')).fontWeight },
    { bg: bg(document.querySelector('.nav__link')) },
  ];
});
notes.push(`nav CTA background ${ctaStyle.bg} vs link ${linkStyle.bg}`);
if (ctaStyle.bg === linkStyle.bg) fail('nav CTA has the same background as an ordinary nav link');

/* ---- desktop / tablet / mobile breakpoints ------------------------------- */

for (const width of [1440, 1024, 860, 768, 390, 320]) {
  await page.setViewportSize({ width, height: 900 });
  await goto('/');
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (scrollWidth > clientWidth + 1) fail(`horizontal overflow at ${width}px (${scrollWidth} > ${clientWidth})`);

  const { toggleVisible, navOpen, ctaVisible } = await page.evaluate(() => {
    const toggle = document.querySelector('[data-nav-toggle]');
    const nav = document.querySelector('[data-nav]');
    const cta = document.querySelector('.nav__cta');
    const vis = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    return {
      toggleVisible: vis(toggle),
      navOpen: vis(nav) && nav.getBoundingClientRect().height > 0,
      ctaVisible: vis(cta),
    };
  });

  if (width <= 860) {
    if (!toggleVisible) fail(`menu toggle missing at ${width}px`);
    if (navOpen) fail(`nav is expanded before the toggle is pressed at ${width}px`);
    /* open it */
    await page.click('[data-nav-toggle]');
    const afterOpen = await page.evaluate(() => {
      const nav = document.querySelector('[data-nav]');
      const toggle = document.querySelector('[data-nav-toggle]');
      return {
        expanded: toggle.getAttribute('aria-expanded'),
        visible: nav.getBoundingClientRect().height > 0,
        links: [...nav.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().height > 0).length,
      };
    });
    if (afterOpen.expanded !== 'true') fail(`toggle did not set aria-expanded=true at ${width}px`);
    if (!afterOpen.visible) fail(`nav did not become visible after the toggle at ${width}px`);
    if (afterOpen.links !== 5) fail(`open mobile nav shows ${afterOpen.links} links, expected 5`);
    /* Escape closes it and returns focus */
    await page.keyboard.press('Escape');
    const afterEscape = await page.evaluate(() => ({
      expanded: document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'),
      focused: document.activeElement === document.querySelector('[data-nav-toggle]'),
    }));
    if (afterEscape.expanded !== 'false') fail(`Escape did not close the nav at ${width}px`);
    if (!afterEscape.focused) fail(`Escape did not return focus to the toggle at ${width}px`);
  } else {
    if (toggleVisible) fail(`menu toggle visible at ${width}px, where the full nav should show`);
    if (!navOpen) fail(`nav not visible at ${width}px`);
    if (!ctaVisible) fail(`nav CTA not visible at ${width}px`);
  }
}

/* --------------------------------------------------- homepage first screen --- */

for (const [width, height] of [[1440, 900], [390, 844]]) {
  await page.setViewportSize({ width, height });
  await goto('/');
  const facts = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    const words = document.querySelector('main').innerText.trim().split(/\s+/).length;
    return {
      heroCta: box('.hero__actions .btn--primary'),
      headings: [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim()),
      sections: document.querySelectorAll('main > section').length,
      words,
      scrollHeight: document.documentElement.scrollHeight,
      h1: document.querySelectorAll('h1').length,
    };
  });
  notes.push(`home ${width}px: ${facts.sections} sections, ${facts.words} words, ${facts.scrollHeight}px, h2 = ${JSON.stringify(facts.headings)}`);
  if (facts.heroCta && facts.heroCta.bottom > height) {
    fail(`primary CTA is below the fold on the homepage at ${width}x${height}`);
  }
  if (facts.h1 !== 1) fail(`homepage has ${facts.h1} h1 elements`);
  if (facts.sections !== 3) fail(`homepage has ${facts.sections} sections, expected 3`);
}

/* ------------------------------------------------------------ focus rings --- */

await page.setViewportSize({ width: 1440, height: 900 });
for (const selector of ['.nav__link', '.nav__cta', '.btn--primary', '.text-link']) {
  const route = selector === '.btn--primary' ? '/' : '/';
  await goto(route);
  const ring = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.focus();
    const cs = getComputedStyle(el);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlined: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
  }, selector);
  if (!ring) { fail(`no ${selector} found to focus`); continue; }
  if (!ring.outlined) fail(`${selector} has no visible focus ring (${ring.outlineStyle} ${ring.outlineWidth})`);
}

/* Touch targets: nav CTA and buttons should be comfortably tappable. */
await page.setViewportSize({ width: 390, height: 844 });
await goto('/');
await page.click('[data-nav-toggle]');
const smallTargets = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('.nav a, .hero__actions a, .btn')) {
    if (getComputedStyle(a).display === 'none') continue;
    const r = a.getBoundingClientRect();
    if (r.height > 0 && r.height < 32) out.push(`${a.textContent.trim()} (${Math.round(r.height)}px)`);
  }
  return out;
});
if (smallTargets.length) fail(`touch targets under 32px tall: ${smallTargets.join(', ')}`);

/* -------------------------------------------------------- consultation form --- */

await page.setViewportSize({ width: 1440, height: 900 });
await goto('/consultation/');
/* The markup is checked from the served source, not the live DOM: site.js sets
   form.noValidate at runtime, which reflects back to the attribute and would
   make a healthy page look like it shipped novalidate. */
const served = await (await fetch(BASE + '/consultation/')).text();
const servedForm = (served.match(/<form\b[^>]*>/) || [''])[0];
if (/novalidate/i.test(servedForm)) fail('served markup carries novalidate, which breaks the no-JavaScript path');

const form = await page.evaluate(() => {
  const f = document.querySelector('[data-inquiry-form]');
  if (!f) return null;
  /* Count questions, not inputs: a radio group is one question, and the
     honeypot is not a question at all. */
  const groups = new Set();
  for (const el of f.querySelectorAll('input:not([type=hidden]), textarea, select')) {
    if (el.name === 'company') continue;
    groups.add(el.type === 'radio' ? `radio:${el.name}` : `field:${el.name}`);
  }
  const controls = groups.size;
  let labelled = 0;
  for (const key of groups) {
    const [, name] = key.split(':');
    if (key.startsWith('radio:')) {
      const group = f.querySelector(`[role=radiogroup][data-interest-group]`);
      if (group && group.getAttribute('aria-labelledby')) labelled += 1;
      continue;
    }
    const el = f.elements[name];
    const byFor = el && el.id && document.querySelector(`label[for="${el.id}"]`);
    const byWrap = el && el.closest('label');
    if (byFor || byWrap) labelled += 1;
  }
  return {
    action: f.getAttribute('action'),
    controls,
    labelled,
    calendars: document.querySelectorAll('iframe, [class*="calendar"], [id*="calendar"]').length,
    submitLabel: f.querySelector('button[type=submit]').textContent.trim(),
    required: [...new Set([...f.querySelectorAll('[required]')].map((el) => el.type === 'radio' ? el.name : el.name))],
  };
});
if (!form) fail('no consultation form on /consultation/');
else {
  if (form.action !== '/api/inquiry') fail(`form posts to ${form.action}`);
  if (form.calendars) fail('a scheduling widget or iframe is embedded — none is configured');
  if (form.controls > 5) fail(`form collects ${form.controls} fields; the brief asks for the minimum`);
  if (form.labelled !== form.controls) fail(`only ${form.labelled} of ${form.controls} form controls are labelled`);
  notes.push(`consultation form: ${form.controls} controls, required = ${form.required.join(', ')}, submit "${form.submitLabel}"`);

  /* The success message must not claim a booking. */
  await page.evaluate(() => {
    const f = document.querySelector('[data-inquiry-form]');
    f.noValidate = true;
    f.elements.name.value = 'Alex Rivera';
    f.elements.email.value = 'alex@example.com';
    f.querySelector('input[name="interest"][value="unsure"]').checked = true;
    f.elements.consent.checked = true;
  });
  await page.evaluate(() => {
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
  await page.click('[data-inquiry-form] button[type=submit]');
  await page.waitForTimeout(150);
  const status = await page.$eval('[data-form-status]', (el) => ({ text: el.textContent.trim(), state: el.getAttribute('data-state'), live: el.getAttribute('aria-live') }));
  notes.push(`success message: "${status.text}"`);
  if (status.state !== 'success') fail(`form success state not reached (state=${status.state})`);
  if (/scheduled|confirmed|booked for|reserved a time/i.test(status.text) && !/nothing has been scheduled/i.test(status.text)) {
    fail('success message implies an appointment exists');
  }
  if (status.live !== 'polite') fail('form status region is not aria-live="polite"');
}

/* ------------------------------------------------------------- alt / links --- */

const routes = ['/', '/coaching/', '/faq/', '/consultation/', '/about/', '/work-with-me/', '/framework/', '/framework/regulation/', '/privacy/'];
let checkedLinks = 0;
for (const route of routes) {
  await goto(route);
  const dead = await page.evaluate(async (r) => {
    const out = [];
    for (const a of document.querySelectorAll('a[href^="/"]')) {
      const href = a.getAttribute('href').split('#')[0];
      if (!href || href.endsWith('.webp') || href.endsWith('.jpg') || href.endsWith('.svg')) continue;
      const res = await fetch(href, { method: 'HEAD' });
      if (!res.ok) out.push(`${href} → ${res.status}`);
    }
    return out;
  }, route);
  checkedLinks += await page.$$eval('a[href^="/"]', (els) => els.length);
  for (const d of dead) fail(`${route}: broken internal link ${d}`);

  const imgProblems = await page.$$eval('img', (els) => els.filter((e) => !e.getAttribute('alt') || !e.getAttribute('width') || !e.getAttribute('height')).map((e) => e.currentSrc || e.src));
  for (const i of imgProblems) fail(`${route}: image without alt/width/height: ${i}`);
}

notes.push(`internal links followed: ${checkedLinks}`);

await browser.close();

console.log(notes.map((n) => `  · ${n}`).join('\n'));
if (problems.length) {
  console.error(`\n✗ ${problems.length} UI problem(s):\n`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\n✓ UI checks passed');
