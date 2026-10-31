/**
 * build.mjs — static site generator for FareedQ.com
 *
 * Zero dependencies. Node 18+.
 *
 *   node build.mjs           regenerate the site into dist/
 *   node build.mjs --check   fail if content has a broken internal link,
 *                            missing alt text, or a heading-order problem
 *
 * Source of truth:
 *   content/site.json               site-wide config and metadata
 *   content/*.json                  structured page content (home, coaching, …)
 *   content/pages/*.md              long-form prose pages (about)
 *   content/framework/*.md|json     the Framework body of knowledge
 *   content/essays/*.md             standalone essays
 *   src/styles.css                  design tokens and components
 *   public/                         copied verbatim (fonts, photography, _headers, …)
 *
 * Everything under dist/ is generated. Never hand-edit it.
 */

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, copyFileSync, statSync,
} from 'node:fs';
import { join, dirname, basename, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(ROOT, 'content');
const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const CHECK = process.argv.includes('--check');

const site = JSON.parse(readFileSync(join(CONTENT, 'site.json'), 'utf8'));
const SITE_URL = site.url.replace(/\/$/, '');

/* Business configuration. Every price, package detail, and payment statement on
   the site is rendered from this object — see content/offer.json. */
const offer = JSON.parse(readFileSync(join(CONTENT, 'offer.json'), 'utf8')).offer;

/* The date the privacy notice was last checked against the enquiry pipeline in
   this repository. Update it whenever either changes. */
const PRIVACY_UPDATED = '2026-10-30';

/* Diagram copy for the framework pages. Prose lives in content, not in markup. */
const diagrams = JSON.parse(readFileSync(join(CONTENT, 'framework', 'diagrams.json'), 'utf8'));

/* The single source of truth has to agree with itself: if the package price and
   the advertised per-session rate ever drift apart, fail the build rather than
   publish arithmetic that does not add up. */
(function validateOffer() {
  const compareAt = offer.single.price * offer.package.sessions;
  const effective = offer.package.price / offer.package.sessions;
  const saving = Math.round((1 - offer.package.price / compareAt) * 100);
  if (effective !== offer.package.perSession) {
    throw new Error(
      `content/offer.json: ${offer.package.price} over ${offer.package.sessions} sessions ` +
      `is ${effective} per session, not ${offer.package.perSession}.`
    );
  }
  if (saving !== offer.package.savingPercent) {
    throw new Error(
      `content/offer.json: the package discount is ${saving}%, not ${offer.package.savingPercent}%.`
    );
  }
  if (!offer.pilot || !Number.isInteger(offer.pilot.capacity) || offer.pilot.capacity < 1) {
    throw new Error('content/offer.json: offer.pilot.capacity must be a whole number of clients.');
  }

  /* A refund must never be negative: unused sessions are recalculated at the
     single-session rate, and the result floors at zero rather than becoming a
     charge the client did not agree to. */
  const refundExample = Math.max(
    0,
    offer.package.price - (offer.refund.exampleCompleted * offer.single.price)
  );

  /* Every figure that appears anywhere in this file — policy prose included —
     has to be one of these derived values. Copy cannot quietly introduce a
     price, a rate, or a refund amount the arithmetic does not support. */
  offer.knownAmounts = [
    offer.single.price,
    offer.package.price,
    offer.package.perSession,
    compareAt,
    refundExample,
  ];
  const prose = [
    ...Object.values(offer.policies).flatMap((p) => [p.summary || '', p.note || '']),
    offer.paymentNote,
    offer.single.summary, offer.single.suits,
    offer.package.summary, offer.package.suits,
  ].join(' ');
  for (const m of prose.matchAll(/\$([0-9]+)/g)) {
    const amount = Number(m[1]);
    if (!offer.knownAmounts.includes(amount)) {
      throw new Error(
        `content/offer.json: "$${amount}" appears in copy but is not a price this file derives ` +
        `(${offer.knownAmounts.join(', ')}).`
      );
    }
  }
  offer.package.compareAt = compareAt;
})();

/* Policies still to be confirmed before launch. Reported at the end of a build
   and never printed on the site: an invented cancellation rule is worse than an
   absent one. */
const unconfirmedPolicies = Object.entries(offer.policies)
  .filter(([, p]) => p.status !== 'confirmed')
  .map(([key, p]) => `${key} — ${p.note}`);

/* =========================================================================
   helpers
   ========================================================================= */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escape, then apply inline markdown. */
function inline(text) {
  let out = esc(text);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const ext = /^https?:/i.test(href);
    const attrs = ext ? ' rel="noopener"' : '';
    const cls = ' class="text-link"' ;
    return `<a href="${href}"${cls}${attrs}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

/** Minimal, predictable markdown subset. Intentionally not a full parser. */
function markdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  let listType = null;
  let listItems = [];

  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
  };
  const flushList = () => {
    if (listType) {
      const tag = listType === 'ol' ? 'ol' : 'ul';
      out.push(`<${tag}>\n${listItems.map((x) => `  <li>${inline(x)}</li>`).join('\n')}\n</${tag}>`);
      listType = null; listItems = [];
    }
  };
  const flushAll = () => { flushPara(); flushList(); };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flushAll(); i++; continue; }

    if (/^---+$/.test(trimmed)) { flushAll(); out.push('<hr />'); i++; continue; }

    /* A diagram placed in the flow of prose by content, not by markup:
         {{pillars}}  {{zones}}  {{layers}}
       The components are rendered from content/framework/diagrams.json. */
    const directive = trimmed.match(/^\{\{([a-z-]+)\}\}$/);
    if (directive && COMPONENTS[directive[1]]) {
      flushAll();
      out.push(COMPONENTS[directive[1]]());
      i++; continue;
    }

    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }

    const ul = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul'; listItems.push(ul[1]); i++; continue;
    }

    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol'; listItems.push(ol[1]); i++; continue;
    }

    const bq = trimmed.match(/^>\s?(.*)$/);
    if (bq) {
      flushAll();
      const buf = [bq[1]];
      i++;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].trim().replace(/^>\s?/, '')); i++;
      }
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushAll();
  return out.join('\n');
}

/** Split frontmatter from body. Supports flat `key: value` and JSON values. */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw.trim() };
  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    data[kv[1]] = val;
  }
  return { data, body: m[2].trim() };
}

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const slugOf = (file) => basename(file, extname(file));

function readDirFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => exts.includes(extname(f)))
    .sort()
    .map((f) => join(dir, f));
}

/* =========================================================================
   site structure
   ========================================================================= */

const NAV = [
  { label: 'Coaching', href: '/coaching/' },
  { label: 'Philosophy', href: '/framework/' },
  { label: 'About', href: '/about/' },
  { label: 'Work with me', href: '/work-with-me/' },
];

/* The one call to action the whole site points at. The wording is deliberately
   the same everywhere; context-specific secondary links are plain text links. */
const START = { label: 'Express Interest in Coaching', href: '/onboarding/' };

/** Load every framework document (markdown or json). */
function loadFramework() {
  const dir = join(CONTENT, 'framework');
  const docs = [];

  for (const file of readDirFiles(dir, ['.md'])) {
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
    const slug = data.slug || slugOf(file);
    docs.push({
      kind: 'prose', slug,
      title: data.title, heading: data.heading || data.title,
      metaTitle: data.metaTitle, metaDescription: data.metaDescription,
      lede: data.lede, standfirst: data.standfirst,
      order: Number(data.order || 99),
      group: data.group || 'primary',
      html: markdown(body),
    });
  }

  for (const file of readDirFiles(dir, ['.json'])) {
    const d = readJSON(file);
    if (!Array.isArray(d.categories)) continue;   /* diagrams.json is not a document */
    const slug = d.slug || slugOf(file);
    docs.push({
      kind: 'glossary', slug,
      /* Navigation uses the short `title`; the page itself keeps the fuller
         `heading`. */
      title: d.title || d.heading || 'Glossary', heading: d.heading,
      metaTitle: d.metaTitle, metaDescription: d.metaDescription,
      lede: d.lede, standfirst: d.standfirst,
      order: Number(d.order || 99),
      group: d.group || 'primary',
      glossary: d,
    });
  }

  return docs.sort((a, b) => a.order - b.order);
}

function loadEssays() {
  const dir = join(CONTENT, 'essays');
  return readDirFiles(dir, ['.md']).map((file) => {
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
    return {
      slug: data.slug || slugOf(file),
      title: data.title, heading: data.heading || data.title,
      metaTitle: data.metaTitle, metaDescription: data.metaDescription,
      lede: data.lede, standfirst: data.standfirst,
      date: data.date, order: Number(data.order || 99),
      html: markdown(body),
    };
  }).sort((a, b) => a.order - b.order);
}

/** Rough reading time, used on essays and framework pages. */
function readingTime(html) {
  const words = String(html).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 225));
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/* =========================================================================
   shared chrome
   ========================================================================= */

function head({ title, description, path, ogType = 'website', image, ogImageSize = { w: 1200, h: 630 }, noindex = false, jsonLd }) {
  const canonical = `${SITE_URL}${path}`;
  /* Social cards must be JPEG or PNG — several scrapers still ignore WebP,
     including some link previews and messaging clients. */
  const ogImage = image ? (image.startsWith('http') ? image : `${SITE_URL}${image}`) : `${SITE_URL}/assets/og-default.jpg`;
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${canonical}" />${noindex ? '\n<meta name="robots" content="noindex, follow" />' : ''}
<meta name="author" content="${esc(site.name)}" />
<meta name="theme-color" content="#253551" />

<meta property="og:type" content="${ogType}" />
<meta property="og:site_name" content="${esc(site.name)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:width" content="${ogImageSize.w}" />
<meta property="og:image:height" content="${ogImageSize.h}" />
<meta property="og:image:alt" content="${esc(site.name)} — ${esc(site.role)}" />
<meta property="og:locale" content="en_CA" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />

<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="preload" href="/fonts/archivo-latin-var.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/styles.css" />
<link rel="sitemap" href="/sitemap.xml" />${jsonLd ? `\n<script type="application/ld+json">${jsonLd}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>`;
}

function masthead({ current }) {
  const links = NAV.map((item) => {
    const active = current === item.href ? ' aria-current="page"' : '';
    return `        <a class="nav__link" href="${item.href}"${active}>${esc(item.label)}</a>`;
  }).join('\n');

  return `
<header class="masthead">
  <div class="wrap masthead__inner">
    <a class="wordmark" href="/">Fareed Quraishi</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
      Menu
    </button>
    <nav class="nav" id="site-nav" aria-label="Primary" data-nav>
${links}
      <a class="nav__cta" href="${START.href}">${esc(START.label)}</a>
    </nav>
  </div>
</header>`;
}

function footer(docs) {
  /* The footer names the philosophy's primary pages and the glossary. The
     influences and recognition tools are reachable from the philosophy pages
     themselves; the footer is not the place to promote them. */
  const frameworkLinks = [...docs.filter((d) => d.group === 'primary' && d.slug !== 'introduction'),
    ...docs.filter((d) => d.slug === 'glossary')]
    .map((d) => `          <li><a href="/framework/${d.slug}/">${esc(d.title)}</a></li>`)
    .join('\n');

  return `
<footer class="footer">
  <div class="wrap footer__inner">
    <div class="footer__top">
      <div class="footer__brand">
        <p class="footer__name">Fareed Quraishi</p>
        <p class="footer__blurb">Life coaching grounded in Authentic Manifestation: nervous system regulation, a viable life, and the practice of participating.</p>
        <p class="footer__location">${esc(site.location)}</p>
      </div>
      <div>
        <p class="footer__h">Coaching</p>
        <ul>
          <li><a href="/coaching/">What coaching involves</a></li>
          <li><a href="/work-with-me/">The pilot and pricing</a></li>
          <li><a href="/onboarding/">Express Interest in Coaching</a></li>
          <li><a href="/about/">About Fareed</a></li>
        </ul>
      </div>
      <div>
        <p class="footer__h">Philosophy</p>
        <ul>
          <li><a href="/framework/">Introduction</a></li>
${frameworkLinks}
        </ul>
      </div>
      <div>
        <p class="footer__h">Elsewhere</p>
        <ul>
${site.social.map((s) => `          <li><a href="${s.href}" rel="me noopener">${esc(s.label)}<span class="footer__handle">${esc(s.handle)}</span></a></li>`).join('\n')}
          <li><a href="mailto:${esc(site.email)}">Email</a></li>
        </ul>
      </div>
    </div>
    <div class="footer__bottom">
      <p class="footer__scope">Coaching is personal development support. It is not psychotherapy, diagnosis, or medical treatment, and it does not replace them. <a href="/work-with-me/#scope">Scope of practice</a>.</p>
      <p><a href="/privacy/">Privacy</a> &middot; &copy; ${new Date().getFullYear()} Fareed Quraishi</p>
    </div>
  </div>
</footer>
<script src="/site.js" defer></script>
</body>
</html>`;
}

/* Small progressive enhancement: mobile nav + the onboarding form. The site is
   fully functional and readable without it, and every message a visitor sees
   comes from content/onboarding.json. */
function buildSiteJs(onboarding) {
  const email = site.email;
  return `/* FareedQ.com — progressive enhancement only. */
(function () {
  'use strict';

  /* ---- mobile navigation ------------------------------------------------ */
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', open ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        nav.setAttribute('data-open', 'false');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* ---- onboarding form -------------------------------------------------- */
  var form = document.querySelector('[data-inquiry-form]');
  if (!form) return;

  /* The markup keeps the browser's own constraints so that a form without
     JavaScript is still validated natively. Once this script runs, the site's
     validation takes over — one error style, focus management, and a live
     status region rather than browser tooltips. */
  form.noValidate = true;

  var status = form.querySelector('[data-form-status]');
  var button = form.querySelector('button[type="submit"]');
  var interestGroup = form.querySelector('[data-interest-group]');
  var startedAt = Date.now();

  function show(state, message) {
    if (!status) return;
    status.setAttribute('data-state', state);
    status.setAttribute('data-visible', 'true');
    status.textContent = message;
  }

  function boxError(id, message) {
    var box = document.getElementById(id + '-error');
    if (!box) return;
    box.textContent = message || '';
    box.setAttribute('data-visible', message ? 'true' : 'false');
  }

  function fieldError(el, message) {
    if (!el) return;
    if (message) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
    boxError(el.id, message);
  }

  function interestError(message) {
    if (!interestGroup) return;
    if (message) interestGroup.setAttribute('aria-invalid', 'true');
    else interestGroup.removeAttribute('aria-invalid');
    boxError('interest', message);
  }

  function checkedValue(field) {
    var el = form.querySelector('input[name="' + field + '"]:checked');
    return el ? el.value : '';
  }

  function validate() {
    var ok = true;
    var firstBad = null;

    var name = form.elements.name;
    if (name) {
      if (!name.value.trim()) {
        fieldError(name, 'Please enter your name.'); ok = false; firstBad = firstBad || name;
      } else if (name.value.trim().length > 100) {
        fieldError(name, 'That name is a little too long.'); ok = false; firstBad = firstBad || name;
      } else { fieldError(name, ''); }
    }

    var emailField = form.elements.email;
    if (emailField) {
      var value = emailField.value.trim();
      if (!value) {
        fieldError(emailField, 'Please enter your email address so I can reply.'); ok = false; firstBad = firstBad || emailField;
      } else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(value)) {
        fieldError(emailField, 'That does not look like an email address.'); ok = false; firstBad = firstBad || emailField;
      } else { fieldError(emailField, ''); }
    }

    if (interestGroup && !checkedValue('interest')) {
      interestError('Please choose one of the three options — “not sure yet” is a real answer.');
      ok = false; firstBad = firstBad || interestGroup;
    } else { interestError(''); }

    var msg = form.elements.message;
    if (msg && msg.value.length > 4000) {
      fieldError(msg, 'Please keep this under 4000 characters.'); ok = false; firstBad = firstBad || msg;
    } else if (msg) { fieldError(msg, ''); }

    var consent = form.elements.consent;
    if (consent && !consent.checked) {
      fieldError(consent, 'Please confirm that you have read the scope of this work.');
      ok = false; firstBad = firstBad || consent;
    } else { fieldError(consent, ''); }

    if (firstBad) firstBad.focus();
    return ok;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) { show('error', 'Please check the highlighted fields.'); return; }

    var payload = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      interest: checkedValue('interest'),
      message: form.elements.message ? form.elements.message.value.trim() : '',
      consent: Boolean(form.elements.consent && form.elements.consent.checked),
      company: form.elements.company ? form.elements.company.value : '',
      elapsed: Date.now() - startedAt,
    };

    if (button) { button.setAttribute('aria-busy', 'true'); button.disabled = true; }

    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        if (r.ok && r.body && r.body.ok) {
          form.reset();
          interestError('');
          show('success', ${JSON.stringify(onboarding.form.success)});
          if (status) status.focus();
        } else {
          var m = (r.body && r.body.error) || 'Something went wrong and your enquiry was not sent.';
          show('error', m + ' You can also email me directly at ${email}.');
          if (status) status.focus();
        }
      })
      .catch(function () {
        show('error', 'Your enquiry could not be sent — this is usually a connection problem. Please try again, or email me directly at ${email}.');
        if (status) status.focus();
      })
      .then(function () {
        if (button) { button.removeAttribute('aria-busy'); button.disabled = false; }
      });
  });

  /* Clear an error as soon as the person corrects it. */
  Array.prototype.forEach.call(form.elements, function (field) {
    if (!field.name) return;
    var event = field.type === 'checkbox' || field.tagName === 'SELECT' ? 'change' : 'input';
    field.addEventListener(event, function () {
      if (field.getAttribute('aria-invalid') === 'true') fieldError(field, '');
      if (field.name === 'interest' && interestGroup) interestError('');
    });
  });
})();
`;
}

/* =========================================================================
   components
   ========================================================================= */

const motif = (steps) => `
      <div class="motif">
${steps.map((s) => `        <article class="motif__step">
          <p class="motif__n">${esc(s.n)}</p>
          <div>
${s.kicker ? `            <p class="label">${esc(s.kicker)}</p>` : ''}
            <h3 class="motif__name">${esc(s.name)}</h3>
            <p class="motif__summary">${inline(s.summary)}</p>
${s.body ? `            <p class="motif__body">${inline(s.body)}</p>` : ''}
          </div>
        </article>`).join('\n')}
      </div>`;

/* The three pillars are deliberately not drawn as an arrow. They are
   reciprocal, not sequential, and the old Regulation → Capacity → Authorship
   chain implied a staircase the framework rejects. */
const motifBar = () => `
      <p class="motif-bar">
        <span class="motif-bar__item"><span class="motif-bar__swatch motif-bar__swatch--1"></span>Nervous system regulation</span>
        <span class="motif-bar__sep" aria-hidden="true">&middot;</span>
        <span class="motif-bar__item"><span class="motif-bar__swatch motif-bar__swatch--2"></span>Minimal viable life</span>
        <span class="motif-bar__sep" aria-hidden="true">&middot;</span>
        <span class="motif-bar__item"><span class="motif-bar__swatch motif-bar__swatch--3"></span>Participation</span>
      </p>`;

const markerList = (items) => `
      <ul class="marker-list">
${items.map((i) => `        <li>${inline(i)}</li>`).join('\n')}
      </ul>`;

const listComponent = (items) => `
      <ul class="list">
${items.map((i) => {
  if (typeof i === 'string') return `        <li>${inline(i)}</li>`;
  return `        <li>
          <p class="list__name">${inline(i.name)}</p>
          <p class="list__body">${inline(i.body)}</p>
        </li>`;
}).join('\n')}
      </ul>`;

const processList = (steps) => `
      <ol class="process">
${steps.map((s) => `        <li>
          <div>
            <p class="list__name">${esc(s.name)}</p>
            <p class="list__body">${inline(s.body)}</p>
          </div>
        </li>`).join('\n')}
      </ol>`;

const factsList = (items) => `
      <dl class="facts">
${items.map((i) => `        <div class="facts__row">
          <dt>${esc(i.label)}</dt>
          <dd>${inline(i.value)}</dd>
        </div>`).join('\n')}
      </dl>`;

/* Confirmed business policies, published as statements. Anything still marked
   "unconfirmed" in content/offer.json is reported by the build and never
   printed: an invented cancellation rule is worse than an absent one. */
const confirmedPolicies = () => Object.values(offer.policies)
  .filter((p) => p.status === 'confirmed' && p.summary)
  .map((p) => ({ label: p.label, value: p.summary }));

/* ------------------------------------------------------------- diagrams -- */

/* All diagram copy comes from content/framework/diagrams.json and is placed in
   prose with {{pillars}}, {{zones}}, or {{layers}}. */

function pillarsDiagram() {
  const { title, caption, items } = diagrams.pillars;
  return `<figure class="diagram diagram--pillars">
  <figcaption class="diagram__title">${esc(title)}</figcaption>
  <div class="pillars">
${items.map((p) => `    <article class="pillar">
      <p class="label">${esc(p.kicker)}</p>
      <h3 class="pillar__name">${esc(p.name)}</h3>
      <p class="pillar__q">${esc(p.question)}</p>
      <p class="pillar__body">${inline(p.body)}</p>
      <p class="pillar__link"><a class="text-link" href="${p.href}">${esc(p.link)}</a></p>
    </article>`).join('\n')}
  </div>
  <p class="diagram__caption">${inline(caption)}</p>
</figure>`;
}

function zonesDiagram() {
  const { title, caption, items } = diagrams.zones;
  return `<figure class="diagram diagram--zones">
  <figcaption class="diagram__title">${esc(title)}</figcaption>
  <dl class="zones">
${items.map((z) => `    <div class="zone zone--${esc(z.tone)}">
      <dt class="zone__name"><span class="zone__dot" aria-hidden="true"></span>${esc(z.name)}</dt>
      <dd class="zone__body">${inline(z.body)}</dd>
    </div>`).join('\n')}
  </dl>
  <p class="diagram__caption">${inline(caption)}</p>
</figure>`;
}

function layersDiagram() {
  const { title, caption, items } = diagrams.layers;
  return `<figure class="diagram diagram--layers">
  <figcaption class="diagram__title">${esc(title)}</figcaption>
  <ol class="layers">
${items.map((l) => `    <li class="layers__item">
      <p class="layers__n">${esc(l.n)}</p>
      <div>
        <h3 class="layers__name">${esc(l.name)}</h3>
        <p class="layers__body">${inline(l.body)}</p>
      </div>
    </li>`).join('\n')}
  </ol>
  <p class="diagram__caption">${inline(caption)}</p>
</figure>`;
}

const COMPONENTS = { pillars: pillarsDiagram, zones: zonesDiagram, layers: layersDiagram };

/* -------------------------------------------------------------- pricing -- */

const money = (n) => `${offer.symbol}${n}`;

/* The pilot cohort size is a business fact and lives in content/offer.json.
   It is spelled out in running prose and printed as a digit nowhere. */
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spellNumber = (n) => NUMBER_WORDS[n] || String(n);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pilotCapacity = () => spellNumber(offer.pilot.capacity);

function priceOption(key) {
  const o = offer[key];
  const unit = key === 'package'
    ? `${o.sessions} sessions &middot; ${offer.session.minutes} minutes each &middot; ${money(o.perSession)} per session`
    : `${offer.session.minutes} minutes &middot; one-to-one`;
  const maths = key === 'package'
    ? `Six single sessions would be ${money(o.compareAt)} at the pilot rate — this is ${o.savingPercent}% less.`
    : `The standard pilot rate for a single session. No commitment to more.`;

  return `        <article class="price price--${esc(key)}">
          <p class="label">${esc(o.name)}</p>
          <p class="price__amount"><span class="price__figure">${money(o.price)}</span> <span class="price__currency">${esc(offer.currency)}</span></p>
          <p class="price__unit">${unit}</p>
          <p class="price__summary">${inline(o.summary)}</p>
          <p class="price__suits">${inline(o.suits)}</p>
          <p class="price__maths">${maths}</p>
        </article>`;
}

function pricingOptions() {
  return `      <div class="pricing">
${priceOption('single')}
${priceOption('package')}
      </div>
      <p class="pricing__note">${inline(offer.paymentNote)}</p>`;
}

/* The compact form used on the homepage: present, not dominant. */
function priceSummary() {
  return `        <dl class="pilot-prices">
          <div class="pilot-price">
            <dt>${esc(offer.single.name)}</dt>
            <dd><span class="pilot-price__figure">${money(offer.single.price)}</span> <span class="pilot-price__note">${esc(offer.currency)} &middot; ${offer.session.minutes} minutes</span></dd>
          </div>
          <div class="pilot-price">
            <dt>${esc(offer.package.name)}</dt>
            <dd><span class="pilot-price__figure">${money(offer.package.price)}</span> <span class="pilot-price__note">${esc(offer.currency)} &middot; ${offer.package.sessions} sessions, ${money(offer.package.perSession)} each</span></dd>
          </div>
        </dl>`;
}

/* A one-sentence price reference, derived from content/offer.json. It appears
   early on the homepage and the coaching page so the pilot price is
   discoverable without either page turning into a price table. */
const pricingLine = () =>
  `Pilot coaching: ${money(offer.single.price)} ${esc(offer.currency)} for one session, or ${money(offer.package.price)} for six.`;

/* =========================================================================
   pages
   ========================================================================= */

const pages = [];

function page(path, html) {
  pages.push({ path, html });
}

/* ---------------------------------------------------------------- home --- */

function buildHome() {
  const home = readJSON(join(CONTENT, 'home.json')).home;
  const h = home.hero;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site.name,
    url: SITE_URL,
    jobTitle: 'Life coach',
    description: site.description,
    knowsAbout: [
      'Nervous system regulation',
      'Authentic Manifestation',
      'Minimal Viable Life',
      'Somatic coaching',
      'Polyvagal theory',
    ],
    address: { '@type': 'PostalAddress', addressRegion: 'Ontario', addressCountry: 'CA' },
  });

  const html = `${head({
    title: home.metaTitle,
    description: home.metaDescription,
    path: '/',
    jsonLd,
  })}
${masthead({ current: '/' })}

<main id="main">

  <section class="hero">
    <div class="wrap hero__inner">
      <div>
        <p class="label hero__eyebrow">${esc(h.eyebrow)}</p>
        <h1 class="hero__title">${esc(h.title)}</h1>
        <p class="hero__lede">${esc(h.lede)}</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="${h.actions[0].href}">${esc(h.actions[0].label)}</a>
          <a class="btn btn--quiet" href="${h.actions[1].href}">${esc(h.actions[1].label)}</a>
        </div>
        <div class="hero__pilot">
          <div class="hero__pilot-intro">
            <p class="label">${esc(h.pilot.label)}</p>
            <p class="hero__pilot-title">${esc(h.pilot.heading)}</p>
          </div>
          <div class="hero__pilot-meta">
            <ul class="hero__pilot-prices">
${['single', 'package'].map((key) => `              <li class="hero__pilot-price">
                <span class="hero__pilot-figure">${money(offer[key].price)}</span>
                <span class="hero__pilot-cur">${esc(offer.currency)}</span>
                <span class="hero__pilot-sep" aria-hidden="true">&middot;</span>
                <span>${esc(offer[key].shortName)}</span>
              </li>`).join('\n')}
            </ul>
            <a class="hero__pilot-link" href="${h.pilot.href}">${esc(h.pilot.link)}</a>
          </div>
        </div>
      </div>
      <figure class="hero__figure">
        <img class="hero__img" src="${h.image.src}" srcset="${h.image.srcset}" sizes="(max-width: 900px) 100vw, 42vw" width="${h.image.width}" height="${h.image.height}" alt="${esc(h.image.alt)}" fetchpriority="high" decoding="async" />
      </figure>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="who-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.who.label)}</p>
          <h2 class="h2 h2--ruled mt-2" id="who-title">${esc(home.who.title)}</h2>
        </div>
        <div>
          <p class="lede lede-narrow">${inline(home.who.intro)}</p>
          <div class="mt-5">
${markerList(home.who.items)}
          </div>
          <div class="mt-4">
            <div class="callout callout--quiet">
              <p>${inline(home.who.note)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" aria-labelledby="framework-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.framework.label)}</p>
          <h2 class="h2 mt-2" id="framework-title">${esc(home.framework.title)}</h2>
        </div>
        <div>
          <p class="lede lede-narrow">${inline(home.framework.intro)}</p>
        </div>
      </div>
      <div class="mt-5">
${motif(home.framework.steps)}
      </div>
      <div class="mt-4">
        <div class="callout">
          <p>${inline(home.framework.footnote)}</p>
          <p><a class="text-link" href="${home.framework.link.href}">${esc(home.framework.link.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="work-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.work.label)}</p>
          <h2 class="h2 mt-2" id="work-title">${esc(home.work.title)}</h2>
        </div>
        <div>
          <p class="lede lede-narrow">${inline(home.work.intro)}</p>
        </div>
      </div>
      <div class="split mt-5">
        <div>
          <h3 class="h3">${esc(home.work.first.title)}</h3>
        </div>
        <div>
          <p>${inline(home.work.first.body)}</p>
        </div>
      </div>

      <div class="mt-4">
        <div class="callout callout--quiet">
          <p>${inline(home.work.note)}</p>
          <p><a class="text-link" href="${home.work.link.href}">${esc(home.work.link.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" aria-labelledby="about-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.about.label)}</p>
          <h2 class="h2 h2--ruled mt-2" id="about-title">${esc(home.about.title)}</h2>
        </div>
        <div>
          <div class="prose">
${home.about.paragraphs.map((p) => `            <p>${inline(p)}</p>`).join('\n')}
          </div>
          <p class="mt-3"><a class="text-link" href="${home.about.link.href}">${esc(home.about.link.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--deep" aria-labelledby="pilot-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.pilot.label)}</p>
          <h2 class="h2 mt-2" id="pilot-title">${esc(home.pilot.title)}</h2>
          <p class="quiet mt-3">One-to-one, ${esc(offer.session.place.toLowerCase())} &middot; ${offer.session.minutes} minutes &middot; priced in ${esc(offer.currency)}</p>
        </div>
        <div>
          <div class="prose">
${home.pilot.paragraphs.map((p) => `            <p>${inline(p)}</p>`).join('\n')}
          </div>
          <div class="mt-4">
${priceSummary()}
          </div>
          <p class="mt-4"><a class="text-link" href="${home.pilot.link.href}">${esc(home.pilot.link.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--navy" aria-labelledby="invite-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="invite-title">${esc(home.invite.title)}</h2>
        </div>
        <div>
          <p class="lede">${inline(home.invite.body)}</p>
          <p class="mt-4"><a class="btn btn--primary" href="${home.invite.action.href}">${esc(home.invite.action.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

</main>
${footer(frameworkDocs)}`;

  page('index.html', html);
}

/* ------------------------------------------------------------ coaching --- */

function buildCoaching() {
  const c = readJSON(join(CONTENT, 'coaching.json')).coaching;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Individual coaching',
    serviceType: 'Personal development coaching',
    description: c.metaDescription,
    provider: { '@type': 'Person', name: site.name, url: SITE_URL },
    areaServed: 'Online',
    url: `${SITE_URL}/coaching/`,
    priceRange: `${offer.symbol}${offer.single.price}-${offer.symbol}${offer.package.price} ${offer.currency}`,
    offers: [offer.single, offer.package].map((o) => ({
      '@type': 'Offer',
      name: o.name,
      price: String(o.price),
      priceCurrency: offer.currency,
      description: o.summary,
      url: `${SITE_URL}/work-with-me/`,
    })),
  });

  const html = `${head({
    title: c.metaTitle, description: c.metaDescription, path: '/coaching/', jsonLd,
  })}
${masthead({ current: '/coaching/' })}

<main id="main">

  <section class="band band--paper">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(c.intro.eyebrow)}</p>
          <h1 class="h2 h1-display mt-2">${esc(c.intro.title)}</h1>
        </div>
        <div>
          <p class="lede">${inline(c.intro.lede)}</p>
          <p class="mt-4"><a class="btn btn--ink" href="${c.intro.action.href}">${esc(c.intro.action.label)}</a></p>
          <p class="price-line mt-4">${pricingLine()} <a class="text-link" href="/work-with-me/">Pilot details and terms</a></p>
        </div>
      </div>
    </div>
  </section>

  <hr class="rule" />

  <section class="band band--warm" aria-labelledby="what-title">
    <div class="wrap">
      <div class="split">
        <div><h2 class="h2" id="what-title">${esc(c.what.title)}</h2></div>
        <div class="prose">
${c.what.paragraphs.map((p) => `          <p>${inline(p)}</p>`).join('\n')}
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="who-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2 h2--ruled" id="who-title">${esc(c.who.title)}</h2>
          <p class="lede mt-3">${inline(c.who.intro)}</p>
        </div>
        <div>
${markerList(c.who.items)}
          <div class="callout callout--quiet mt-4">
            <p>${inline(c.who.note)}</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" id="working-together" aria-labelledby="work-title">
    <div class="wrap">
      <p class="label">Working together</p>
      <h2 class="h2 h2--ruled mt-2" id="work-title">${esc(c.work.title)}</h2>
      <p class="lede lede-narrow mt-3">${inline(c.work.intro)}</p>
      <div class="mt-5">
${listComponent(c.work.items)}
      </div>
      <div class="mt-4">
        <div class="callout callout--quiet">
          <p>${inline(c.work.note)}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="first-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="first-title">${esc(c.first.title)}</h2>
          <p class="lede mt-3">${inline(c.first.intro)}</p>
        </div>
        <div>
${processList(c.first.steps)}
          <div class="callout callout--quiet mt-4">
            <p>${inline(c.first.note)}</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="package-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="package-title">${esc(c.package.title)}</h2>
        </div>
        <div class="prose">
${c.package.paragraphs.map((p) => `          <p>${inline(p)}</p>`).join('\n')}
        </div>
      </div>
    </div>
  </section>

  <section class="band band--deep" aria-labelledby="embodiment-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="embodiment-title">${esc(c.embodiment.title)}</h2>
${motifBar().replace('class="motif-bar"', 'class="motif-bar mt-4"')}
        </div>
        <div class="prose">
${c.embodiment.paragraphs.map((p) => `          <p>${inline(p)}</p>`).join('\n')}
          <p><a class="text-link" href="${c.embodiment.link.href}">${esc(c.embodiment.link.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="not-title">
    <div class="wrap">
      <div class="split">
        <div><h2 class="h2" id="not-title">${esc(c.not.title)}</h2></div>
        <div>
          <div class="callout">
${c.not.paragraphs.map((p) => `            <p>${inline(p)}</p>`).join('\n')}
          </div>
          <p class="mt-3"><a class="text-link" href="${c.not.link.href}">${esc(c.not.link.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" aria-labelledby="practical-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="practical-title">Practical details</h2>
          <p class="quiet mt-2">Pilot pricing. Nothing is charged on this site.</p>
        </div>
        <div>
${factsList([
  { label: 'Format', value: `One-to-one, ${offer.session.place.toLowerCase()}, by video call.` },
  { label: 'Length', value: `${offer.session.minutes} minutes per session.` },
  { label: 'Options', value: `${money(offer.single.price)} ${offer.currency} for a single session, or ${money(offer.package.price)} ${offer.currency} for six — ${money(offer.package.perSession)} each.` },
  { label: 'Pilot size', value: `Up to ${pilotCapacity()} clients, while the practice is still being refined.` },
  { label: 'First step', value: 'A short message in which you say what you are interested in. I reply personally within three business days.' },
  { label: 'Between sessions', value: 'Usually something small to try. An experiment, not homework.' }
])}
          <p class="mt-3"><a class="text-link" href="/work-with-me/">How the pilot works, and what is included</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="faq-title">
    <div class="wrap">
      <p class="label">FAQ</p>
      <h2 class="h2 h2--ruled mt-2" id="faq-title">${esc(c.faq.title)}</h2>
      <dl class="faq mt-5">
${c.faq.items.map((item) => `        <div class="faq__item">
          <dt class="faq__q">${inline(item.q)}</dt>
          <dd class="faq__a">${inline(item.a)}</dd>
        </div>`).join('\n')}
      </dl>
    </div>
  </section>

  <section class="band band--navy" aria-labelledby="start-title">
    <div class="wrap">
      <div class="split">
        <div><h2 class="h2" id="start-title">${esc(c.start.title)}</h2></div>
        <div>
          <p class="lede">${inline(c.start.body)}</p>
          <p class="mt-4"><a class="btn btn--primary" href="${c.start.action.href}">${esc(c.start.action.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

</main>
${footer(frameworkDocs)}`;

  page('coaching/index.html', html);
}

/* --------------------------------------------------------------- about --- */

function buildAbout() {
  const { data, body } = parseFrontmatter(readFileSync(join(CONTENT, 'pages', 'about.md'), 'utf8'));

  /* The same portrait as the homepage hero — one photograph, used twice, so the
     person is visible on the page about the person. */
  const portrait = readJSON(join(CONTENT, 'home.json')).home.hero.image;

  /* A `{{panel}}` line splits the prose into bands. The middle band is the deeper
     sand tone: it carries the "where I am now" material, which is the part a
     reader is most likely to be weighing when they decide whether to write. */
  const bands = [
    'band--paper',
    'band--deep',
    'band--paper',
  ];
  const parts = body
    .split(/^\{\{panel\}\}\s*$/m)
    .map((part) => part.trim())
    .filter(Boolean);

  const proseSections = parts.map((part, i) => `
  <section class="band ${bands[i] || 'band--paper'}">
    <div class="wrap">
      <div class="prose">
${markdown(part)}
      </div>${i === parts.length - 1 ? `
      <div class="mt-5 measure-block">
        <div class="callout">
          <p>If you would like to express interest in coaching, the first step is a short message. <a class="text-link" href="/coaching/">What coaching involves</a> is the other place to start.</p>
          <p><a class="btn btn--ink" href="${START.href}">${esc(START.label)}</a></p>
        </div>
      </div>` : ''}
    </div>
  </section>`).join('\n');

  const html = `${head({
    title: data.metaTitle, description: data.metaDescription, path: '/about/', ogType: 'profile',
  })}
${masthead({ current: '/about/' })}

<main id="main">
  <section class="page-head page-head--media band--paper">
    <div class="wrap page-head__inner">
      <div>
        <p class="label">${esc(data.title)}</p>
        <h1 class="mt-2">${esc(data.heading)}</h1>
        <p class="lede">${esc(data.lede)}</p>
        <p class="standfirst">${esc(data.standfirst)}</p>
        <p class="page-head__location">${esc(site.location)}</p>
      </div>
      <figure class="page-head__media">
        <img src="${portrait.src}" srcset="${portrait.srcset}" sizes="(max-width: 900px) 100vw, 44vw" width="${portrait.width}" height="${portrait.height}" alt="${esc(portrait.alt)}" decoding="async" />
      </figure>
    </div>
  </section>
${proseSections}
</main>
${footer(frameworkDocs)}`;

  page('about/index.html', html);
}

/* ------------------------------------------------------------- privacy --- */

/* A standalone prose page, like About but without a call to action: the point of
   a privacy notice is that it is findable and plain, not persuasive. The email
   address comes from content/site.json via the {{email}} token in the markdown. */
function buildPrivacy() {
  const { data, body } = parseFrontmatter(readFileSync(join(CONTENT, 'pages', 'privacy.md'), 'utf8'));

  const html = `${head({
    title: data.metaTitle, description: data.metaDescription, path: '/privacy/',
  })}
${masthead({ current: '/privacy/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">${esc(data.title)}</p>
      <h1 class="mt-2">${esc(data.heading)}</h1>
      <p class="lede">${esc(data.lede)}</p>
      <p class="standfirst">${esc(data.standfirst)}</p>
      <p class="page-head__location">Last updated ${formatDate(PRIVACY_UPDATED)}</p>
    </div>
  </section>

  <section class="band band--paper">
    <div class="wrap">
      <div class="prose prose--centred">
${markdown(body).replace(/\{\{email\}\}/g, esc(site.email))}
      </div>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

  page('privacy/index.html', html);
}

/* ----------------------------------------------------------- framework --- */

function buildFramework(docs) {
  const index = docs[0];
  const rest = docs.slice(1);

  /* The philosophy is the four primary pages. Anything else — recognition
     tools, the glossary, and the intellectual influences behind the work — is
     listed underneath, smaller and clearly secondary, so that no legacy or
     borrowed idea reads as a fourth pillar. */
  const fwGroups = [
    { key: 'supporting', label: 'Supporting' },
    { key: 'influences', label: 'Background and influences' },
  ];
  const primaryDocs = docs.filter((d) => d.group === 'primary');
  const docHref = (d) => `/framework/${d.slug === 'introduction' ? '' : d.slug + '/'}`;

  const fwNav = (currentSlug) => `
        <nav class="fw-aside" aria-label="Philosophy">
          <p class="fw-aside__title">Authentic Manifestation</p>
          <ul>
${primaryDocs.map((d) => `            <li><a href="${docHref(d)}"${d.slug === currentSlug ? ' aria-current="page"' : ''}>${esc(d.title)}</a></li>`).join('\n')}
          </ul>
${fwGroups.map((g) => {
  const items = docs.filter((d) => d.group === g.key);
  if (!items.length) return '';
  return `          <p class="fw-aside__group">${g.label}</p>
          <ul class="fw-aside__secondary">
${items.map((d) => `            <li><a href="${docHref(d)}"${d.slug === currentSlug ? ' aria-current="page"' : ''}>${esc(d.title)}</a></li>`).join('\n')}
          </ul>`;
}).filter(Boolean).join('\n')}
        </nav>`;

  /* --- index ------------------------------------------------------------ */

  /* The overview gets a real in-page contents list, built from its own `##`
     headings, rather than a second copy of the page list below it. */
  const usedIds = new Set();
  const indexHeadings = [...index.html.matchAll(/<h2>(.*?)<\/h2>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ''));
  const anchoredIndex = index.html.replace(/<h2>(.*?)<\/h2>/g, (m, inner) => {
    const text = inner.replace(/<[^>]+>/g, '');
    let id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (usedIds.has(id)) id += '-2';
    usedIds.add(id);
    return `<h2 id="${id}">${inner}</h2>`;
  });

  const indexHtml = `${head({
    title: index.metaTitle, description: index.metaDescription, path: '/framework/',
  })}
${masthead({ current: '/framework/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">Philosophy</p>
      <h1 class="mt-2">${esc(index.heading)}</h1>
      <p class="lede">${esc(index.lede)}</p>
      <p class="standfirst">${esc(index.standfirst)}</p>
    </div>
  </section>

  <section class="band band--paper">
    <div class="wrap">
      <div class="fw-layout">
        <aside>
          <nav class="toc" aria-label="On this page">
            <p class="toc__title">On this page</p>
            <ul>
${indexHeadings.map((h) => {
  const id = h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `              <li><a href="#${id}">${esc(h)}</a></li>`;
}).join('\n')}
            </ul>
          </nav>
        </aside>
        <div>
          <div class="prose prose--wide">
${anchoredIndex}
          </div>

          <div class="mt-5">
            <h2 class="h2 h2--sm">The pages</h2>
            <ul class="fw-nav mt-3">
${primaryDocs.map((d, i) => `              <li><a href="${docHref(d)}">
                <span>
                  <span class="fw-nav__title">${esc(d.title)}</span>
                  <span class="fw-nav__note">${esc(d.lede ? d.lede.slice(0, 118) + '…' : '')}</span>
                </span>
                <span class="fw-nav__order">${String(i + 1).padStart(2, '0')}</span>
              </a></li>`).join('\n')}
            </ul>
          </div>
${fwGroups.map((g) => {
  const items = docs.filter((d) => d.group === g.key);
  if (!items.length) return '';
  return `
          <div class="mt-5">
            <p class="label">${g.label}</p>
            <ul class="fw-nav fw-nav--secondary mt-3">
${items.map((d) => `              <li><a href="${docHref(d)}">
                <span>
                  <span class="fw-nav__title">${esc(d.title)}</span>
                  <span class="fw-nav__note">${esc(d.lede ? d.lede.slice(0, 118) + '…' : '')}</span>
                </span>
              </a></li>`).join('\n')}
            </ul>
          </div>`;
}).filter(Boolean).join('\n')}

          <div class="mt-5 measure-block">
            <div class="callout">
              <p><strong>Reading is not the work.</strong> If any of this names something you are living with, that is what the coaching is for. The philosophy explains the territory; the sessions are where a person actually moves through it.</p>
              <p><a class="text-link" href="/coaching/">What coaching involves</a> &middot; <a class="text-link" href="/work-with-me/">The pilot and its pricing</a> &middot; <a class="text-link" href="/onboarding/">Express Interest in Coaching</a></p>
            </div>
            <div class="callout callout--quiet mt-3">
              <p>These are working ideas rather than settled doctrine. They are grounded in research and clinical work by others — the <a class="text-link" href="/framework/polyvagal-theory/">polyvagal</a> and <a class="text-link" href="/framework/somatic-experiencing/">Somatic Experiencing</a> pages name the lineage — and they will keep being refined.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

  page('framework/index.html', indexHtml);

  /* --- one page per document -------------------------------------------- */
  for (const doc of rest) {
    const isGlossary = doc.kind === 'glossary';
    const path = `/framework/${doc.slug}/`;

    const bodyHtml = isGlossary
      ? doc.glossary.categories.map((cat) => `
        <section class="glossary__cat">
          <h2>${esc(cat.name)}</h2>
          <dl class="glossary__terms">
${cat.terms.map((t) => `            <div class="glossary__term">
              <dt>${esc(t.term)}</dt>
              <dd>${inline(t.definition)}${t.tiers ? `
                <ul class="glossary__tiers">
${t.tiers.map((x) => `                  <li><strong>${esc(x.name)}.</strong> ${inline(x.body)}</li>`).join('\n')}
                </ul>` : ''}
              </dd>
            </div>`).join('\n')}
          </dl>
        </section>`).join('\n')
      : doc.html;

    /* On-page contents for long prose pages. */
    const headings = isGlossary
      ? doc.glossary.categories.map((c) => c.name)
      : [...doc.html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

    const toc = headings.length >= 3 ? `
          <nav class="toc" aria-label="On this page">
            <p class="toc__title">On this page</p>
            <ul>
${headings.map((h) => {
  const id = h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `              <li><a href="#${id}">${esc(h)}</a></li>`;
}).join('\n')}
            </ul>
          </nav>` : '';

    /* Anchor the headings the TOC links to. */
    let anchored = bodyHtml;
    if (!isGlossary) {
      const used = new Set();
      anchored = bodyHtml.replace(/<h2>(.*?)<\/h2>/g, (m, inner) => {
        const text = inner.replace(/<[^>]+>/g, '');
        let id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (used.has(id)) id += '-2';
        used.add(id);
        return `<h2 id="${id}">${inner}</h2>`;
      });
    } else {
      anchored = bodyHtml.replace(/<h2>(.*?)<\/h2>/g, (m, inner) => {
        const id = inner.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `<h2 id="${id}">${inner}</h2>`;
      });
    }

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: doc.heading,
      description: doc.metaDescription,
      url: `${SITE_URL}${path}`,
      author: { '@type': 'Person', name: site.name, url: SITE_URL },
      publisher: { '@type': 'Person', name: site.name },
      isPartOf: { '@type': 'CreativeWorkSeries', name: 'Authentic Manifestation', url: `${SITE_URL}/framework/` },
    });

    const html = `${head({
      title: doc.metaTitle, description: doc.metaDescription, path, ogType: 'article', jsonLd,
    })}
${masthead({ current: '/framework/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">Philosophy${isGlossary ? '' : ` &middot; ${readingTime(doc.html)} min read`}</p>
      <h1 class="mt-2">${esc(doc.heading)}</h1>
      ${doc.lede ? `<p class="lede">${esc(doc.lede)}</p>` : ''}
      ${doc.standfirst ? `<p class="standfirst">${esc(doc.standfirst)}</p>` : ''}
    </div>
  </section>

  <section class="band band--paper">
    <div class="wrap">
      <div class="fw-layout">
${fwNav(doc.slug)}
        <div>
          <div class="prose prose--wide">
${anchored}
          </div>
${toc}
          <div class="mt-5 measure-block">
            <div class="callout">
              <p><strong>The philosophy is the basis of the coaching.</strong> If reading this raised something you would like to work on, that is what the coaching is for.</p>
              <p><a class="text-link" href="/coaching/">What coaching involves</a> &middot; <a class="text-link" href="/work-with-me/">The pilot and its pricing</a> &middot; <a class="text-link" href="/onboarding/">Express Interest in Coaching</a></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

    page(`${path.slice(1)}index.html`, html);
  }
}

/* -------------------------------------------------------------- essays --- */

function buildEssays(essays) {
  const indexHtml = `${head({
    title: 'Earlier writing — an archive — Fareed Quraishi',
    description: 'An archive of earlier pieces on nervous-system regulation, relational patterns, and the scope of coaching practice, kept for anyone arriving from an old link.',
    path: '/essays/',
  })}
${masthead({ current: '/essays/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">Archive</p>
      <h1 class="mt-2">Earlier writing</h1>
      <p class="lede">Pieces written before the current version of the coaching practice took shape. They are kept here because people still arrive from links to them, not because they are part of the offer. The <a class="text-link" href="/framework/">philosophy pages</a> are the current statement of how I work.</p>
    </div>
  </section>

  <section class="band band--paper">
    <div class="wrap">
      <ul class="fw-nav">
${essays.map((e, i) => `        <li><a href="/essays/${e.slug}/">
          <span>
            <span class="fw-nav__title">${esc(e.heading)}</span>
            <span class="fw-nav__note">${esc(e.lede.slice(0, 130))}…</span>
            <span class="fw-nav__note">${formatDate(e.date)} &middot; ${readingTime(e.html)} min read</span>
          </span>
          <span class="fw-nav__order">${String(i + 1).padStart(2, '0')}</span>
        </a></li>`).join('\n')}
      </ul>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

  page('essays/index.html', indexHtml);

  for (const e of essays) {
    const path = `/essays/${e.slug}/`;
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: e.heading,
      description: e.metaDescription,
      url: `${SITE_URL}${path}`,
      datePublished: e.date,
      author: { '@type': 'Person', name: site.name, url: SITE_URL },
      publisher: { '@type': 'Person', name: site.name },
    });

    const headings = [...e.html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    const used = new Set();
    const anchored = e.html.replace(/<h2>(.*?)<\/h2>/g, (m, inner) => {
      const text = inner.replace(/<[^>]+>/g, '');
      let id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (used.has(id)) id += '-2';
      used.add(id);
      return `<h2 id="${id}">${inner}</h2>`;
    });

    const html = `${head({
      title: e.metaTitle, description: e.metaDescription, path, ogType: 'article', jsonLd,
    })}
${masthead({ current: '/essays/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">Essay &middot; ${formatDate(e.date)} &middot; ${readingTime(e.html)} min read</p>
      <h1 class="mt-2">${esc(e.heading)}</h1>
      <p class="lede">${esc(e.lede)}</p>
      ${e.standfirst ? `<p class="standfirst">${esc(e.standfirst)}</p>` : ''}
    </div>
  </section>

  <section class="band band--paper">
    <div class="wrap">
      <div class="prose prose--centred">
${anchored}
      </div>
      <hr class="rule rule--measure mt-5" />
      <p class="mt-3"><a class="text-link" href="/essays/">&larr; All writing</a></p>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

    page(`${path.slice(1)}index.html`, html);
  }
}

/* -------------------------------------------------------- work with me --- */

function buildWorkWithMe() {
  const w = readJSON(join(CONTENT, 'work-with-me.json')).workWithMe;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Individual life coaching — pilot programme',
    serviceType: 'Personal development coaching',
    description: w.metaDescription,
    provider: { '@type': 'Person', name: site.name, url: SITE_URL },
    areaServed: 'Online',
    url: `${SITE_URL}/work-with-me/`,
    priceRange: `${offer.symbol}${offer.single.price}-${offer.symbol}${offer.package.price} ${offer.currency}`,
    offers: [offer.single, offer.package].map((o) => ({
      '@type': 'Offer',
      name: o.name,
      price: String(o.price),
      priceCurrency: offer.currency,
      description: o.summary,
      availability: 'https://schema.org/LimitedAvailability',
      url: `${SITE_URL}/onboarding/`,
    })),
  });

  const html = `${head({
    title: w.metaTitle, description: w.metaDescription, path: '/work-with-me/', jsonLd,
  })}
${masthead({ current: '/work-with-me/' })}

<main id="main">
  <section class="band band--paper">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(w.intro.eyebrow)}</p>
          <h1 class="h2 h1-display mt-2">${esc(w.intro.title)}</h1>
        </div>
        <div>
          <p class="lede">${inline(w.intro.lede)}</p>
${(w.intro.paragraphs || []).map((p) => `          <p class="mt-3">${inline(p)}</p>`).join('\n')}
          <p class="mt-4"><a class="btn btn--ink" href="${w.intro.action.href}">${esc(w.intro.action.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" aria-labelledby="pilot-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(w.pilot.label)}</p>
          <h2 class="h2 mt-2" id="pilot-title">${esc(w.pilot.title)}</h2>
        </div>
        <div>
          <div class="prose">
${w.pilot.paragraphs.map((p) => `            <p>${inline(p)}</p>`).join('\n')}
          </div>
          <div class="mt-5">
            <p class="label">${esc(w.pilot.factsTitle)}</p>
${factsList([
  { label: 'Format', value: `One-to-one, ${offer.session.place.toLowerCase()}, by video call.` },
  { label: 'Length', value: `${offer.session.minutes} minutes per session.` },
  { label: 'Pilot size', value: `Up to ${pilotCapacity()} clients, while the practice is still being refined.` },
  { label: 'Options', value: `${money(offer.single.price)} ${offer.currency} for a single session, or ${money(offer.package.price)} ${offer.currency} for six — ${money(offer.package.perSession)} each.` },
  { label: 'First step', value: 'A short message in which you say what you are interested in. I reply personally within three business days.' }
])}
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--deep" aria-labelledby="options-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="options-title">${esc(w.options.title)}</h2>
          <p class="lede mt-3">${inline(w.options.intro)}</p>
        </div>
        <div>
          <p class="label">All prices in ${esc(offer.currency)}</p>
${pricingOptions()}
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="expect-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="expect-title">${esc(w.expect.title)}</h2>
          <p class="lede mt-3">${inline(w.expect.intro)}</p>
        </div>
        <div>
${listComponent(w.expect.items)}
          <div class="callout callout--quiet mt-4">
            <p>${inline(w.expect.caveat)}</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="how-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="how-title">${esc(w.how.title)}</h2>
          <p class="quiet mt-3">No payment is taken here, and no session is booked by sending a message.</p>
        </div>
        <div>
${processList(w.how.steps)}
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" id="terms" aria-labelledby="terms-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">Working terms</p>
          <h2 class="h2 mt-2" id="terms-title">${esc(w.terms.title)}</h2>
          <p class="lede mt-3">${inline(w.terms.intro)}</p>
        </div>
        <div>
${factsList(confirmedPolicies())}
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" id="scope" aria-labelledby="scope-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">Scope</p>
          <h2 class="h2 mt-2" id="scope-title">${esc(w.scope.title)}</h2>
          <p class="lede mt-3">${inline(w.scope.lede)}</p>
        </div>
        <div>
          <h3 class="h3">${esc(w.scope.supports.title)}</h3>
          <p class="mt-2">${inline(w.scope.supports.intro)}</p>
${markerList(w.scope.supports.items)}
          <p class="quiet mt-3">${inline(w.scope.supports.outro)}</p>

          <h3 class="h3 mt-5">${esc(w.scope.doesNot.title)}</h3>
          <p class="mt-2">${inline(w.scope.doesNot.intro)}</p>
${markerList(w.scope.doesNot.items)}
          <p class="quiet mt-3">${inline(w.scope.doesNot.outro)}</p>

          <h3 class="h3 mt-5">${esc(w.scope.referral.title)}</h3>
          <p class="mt-2">${inline(w.scope.referral.intro)}</p>
          <p class="quiet mt-2">${inline(w.scope.referral.outro)}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--navy" id="inquiry">
    <div class="wrap">
      <div class="split">
        <div><h2 class="h2">${esc(w.final.title)}</h2></div>
        <div>
          <p class="lede">${inline(w.final.body)}</p>
          <p class="mt-4"><a class="btn btn--primary" href="${w.final.action.href}">${esc(w.final.action.label)}</a></p>
        </div>
      </div>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

  page('work-with-me/index.html', html);
}

/* ----------------------------------------------------------- onboarding -- */

function buildOnboarding() {
  const o = readJSON(join(CONTENT, 'onboarding.json')).onboarding;
  const f = o.form;

  /* The three interest options are composed here so their labels and prices
     come from content/offer.json rather than being retyped into the form. */
  const interests = [
    { value: 'single', label: offer.single.name, note: `${money(offer.single.price)} ${offer.currency} &middot; ${offer.session.minutes} minutes` },
    { value: 'package', label: offer.package.name, note: `${money(offer.package.price)} ${offer.currency} &middot; ${offer.package.sessions} sessions, ${money(offer.package.perSession)} each` },
    { value: 'unsure', label: f.fields.interest.unsure.label, note: f.fields.interest.unsure.note },
  ];
  /* The first radio carries `required`, which makes the whole group required to
     a browser without JavaScript. With JavaScript the form is switched to
     noValidate and the site's own validation and error messages take over. */

  const html = `${head({
    title: o.metaTitle, description: o.metaDescription, path: '/onboarding/',
  })}
${masthead({ current: '/onboarding/' })}

<main id="main">
  <section class="band band--paper">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(o.intro.eyebrow)}</p>
          <h1 class="h2 h1-display mt-2">${esc(o.intro.title)}</h1>
        </div>
        <div>
          <p class="lede">${inline(o.intro.lede)}</p>
          <p class="quiet mt-3">${esc(o.intro.note)}</p>
        </div>
      </div>
    </div>
  </section>

  <hr class="rule" />

  <section class="band band--warm" aria-labelledby="form-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="form-title">${esc(f.title)}</h2>
          <p class="lede mt-3">${inline(f.lede)}</p>

          <div class="mt-5">
            <p class="label">${esc(o.how.title)}</p>
${processList(o.how.steps)}
          </div>

          <p class="quiet mt-4">${inline(o.scopeLink.text)}. <a class="text-link" href="${o.scopeLink.href}">${esc(o.scopeLink.label)}</a>.</p>
          <p class="quiet mt-2">${inline(o.termsLink.text)}. <a class="text-link" href="${o.termsLink.href}">${esc(o.termsLink.label)}</a>.</p>
        </div>

        <div>
          <noscript>
            <p class="form__noscript">${inline(f.noscript)} <a href="mailto:${esc(site.email)}">${esc(site.email)}</a>.</p>
          </noscript>

          <form class="form" method="POST" action="/api/inquiry" data-inquiry-form>
            <div class="field">
              <label for="name">${esc(f.fields.name.label)} <span class="req" aria-hidden="true">*</span></label>
              <input type="text" id="name" name="name" autocomplete="name" maxlength="100" required aria-describedby="name-error" />
              <p class="field__error" id="name-error" data-visible="false" role="alert"></p>
            </div>

            <div class="field">
              <label for="email">${esc(f.fields.email.label)} <span class="req" aria-hidden="true">*</span>
                <span class="hint">${esc(f.fields.email.hint)}</span>
              </label>
              <input type="email" id="email" name="email" autocomplete="email" maxlength="254" required aria-describedby="email-error" />
              <p class="field__error" id="email-error" data-visible="false" role="alert"></p>
            </div>

            <div class="field">
              <p class="field__legend" id="interest-legend">${esc(f.fields.interest.label)} <span class="req" aria-hidden="true">*</span></p>
              <div class="choices" role="radiogroup" aria-labelledby="interest-legend" aria-describedby="interest-hint interest-error" aria-required="true" data-interest-group tabindex="-1">
${interests.map((i, n) => `                <label class="choice">
                  <input type="radio" name="interest" value="${esc(i.value)}"${n === 0 ? ' required' : ''} />
                  <span class="choice__body">
                    <span class="choice__label">${esc(i.label)}</span>
                    <span class="choice__note">${i.note}</span>
                  </span>
                </label>`).join('\n')}
              </div>
              <p class="hint" id="interest-hint">${esc(f.fields.interest.hint)}</p>
              <p class="field__error" id="interest-error" data-visible="false" role="alert"></p>
            </div>

            <div class="field">
              <label for="message">${esc(f.fields.message.label)}
                <span class="hint">${esc(f.fields.message.hint)}</span>
              </label>
              <textarea id="message" name="message" rows="5" maxlength="4000" aria-describedby="message-error"></textarea>
              <p class="field__error" id="message-error" data-visible="false" role="alert"></p>
            </div>

            <div class="field field--check">
              <label class="check" for="consent">
                <input type="checkbox" id="consent" name="consent" value="yes" required aria-describedby="consent-error" />
                <span>${esc(f.consent.label)}</span>
              </label>
              <p class="check__detail">${inline(f.consent.text)}</p>
              <p class="field__error" id="consent-error" data-visible="false" role="alert"></p>
              <p class="form__privacy">${inline(o.privacyLink.text)}. <a class="text-link" href="${o.privacyLink.href}">${esc(o.privacyLink.label)}</a>.</p>
            </div>

            <div class="hp" aria-hidden="true">
              <label for="company">Company</label>
              <input type="text" id="company" name="company" tabindex="-1" autocomplete="off" />
            </div>

            <p class="form__consent">${inline(f.privacyNote)}</p>

            <div class="form__actions">
              <button class="btn btn--ink" type="submit">${esc(f.submit)}</button>
            </div>

            <p class="form__status" data-form-status data-visible="false" tabindex="-1" role="status" aria-live="polite"></p>
          </form>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="reassure-title">
    <div class="wrap">
      <div class="split">
        <div><h2 class="h2" id="reassure-title">${esc(o.reassure.title)}</h2></div>
        <div class="prose">
${o.reassure.paragraphs.map((p) => `          <p>${inline(p)}</p>`).join('\n')}
        </div>
      </div>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

  page('onboarding/index.html', html);
}

/* ---------------------------------------------------------------- 404 ---- */

function build404() {
  const html = `${head({
    title: 'Page not found — Fareed Quraishi',
    description: 'That page does not exist. Links to coaching, the framework, and how to get in touch.',
    path: '/404.html',
    noindex: true,
  })}
${masthead({ current: '' })}

<main id="main">
  <section class="band-lg band--paper">
    <div class="wrap">
      <div class="center-narrow">
        <p class="label">404</p>
        <h1 class="h2 mt-2">That page does not exist.</h1>
        <p class="lede mt-3">It may have moved, or the link may be wrong. These are the places worth going instead:</p>
        <ul class="fw-nav mt-4">
          <li><a href="/coaching/"><span><span class="fw-nav__title">Coaching</span><span class="fw-nav__note">What the work is, and who it suits.</span></span></a></li>
          <li><a href="/framework/"><span><span class="fw-nav__title">Authentic Manifestation</span><span class="fw-nav__note">Regulation, a viable life, and participation.</span></span></a></li>
          <li><a href="/work-with-me/"><span><span class="fw-nav__title">The pilot and its pricing</span><span class="fw-nav__note">Two ways to begin, and what to expect.</span></span></a></li>
          <li><a href="/onboarding/"><span><span class="fw-nav__title">Express Interest in Coaching</span><span class="fw-nav__note">A short message, read by me.</span></span></a></li>
        </ul>
      </div>
    </div>
  </section>
</main>
${footer(frameworkDocs)}`;

  page('404.html', html);
}

/* -------------------------------------------------------------- related -- */

function buildSitemap(allPaths) {
  const urls = allPaths
    .filter((p) => p !== '404.html')
    .map((p) => {
      const loc = `${SITE_URL}/${p.replace(/index\.html$/, '')}`;
      return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${p === 'index.html' ? '1.0' : '0.7'}</priority>\n  </url>`;
    }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildRobots() {
  return `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

function buildRedirects() {
  /* Legacy Squarespace paths → new structure. Preserves inbound links and
     search results, and carries the old site's search equity to the new URLs.

     IMPORTANT — do not add a rule whose source is a path this site actually
     serves. Cloudflare Pages applies _redirects *before* static assets:

       "Redirects are always followed, regardless of whether or not an asset
        matches the incoming request."

     So a rule like `/framework  /framework/  301` would capture the real
     framework index and redirect it to itself. There is deliberately no such
     rule: Pages already normalises `/framework` to `/framework/`, because
     dist/framework/index.html exists.

     `/introduction` is safe, and is the one that matters: on the old site
     `/framework` and `/introduction` were the same page. `/framework` now
     resolves to the new framework index on its own, so only `/introduction`
     needs a rule. */
  const map = [
    ['/home', '/'],
    ['/about-me', '/about/'],
    ['/services', '/coaching/'],
    ['/services-offered', '/coaching/'],
    /* The old contact page was a general enquiry form; the equivalent now is
       the coaching onboarding form. */
    ['/contact', '/onboarding/'],
    ['/inquiry', '/onboarding/'],
    /* No fragment in the source: fragments are evaluated by the browser and
       never reach Cloudflare, so a source fragment would simply not match.
       Fragments *are* allowed in destinations, but pointing at the page is
       better than pointing at an anchor, since the scope section is linked
       from the top of it. */
    ['/scope-of-practice', '/work-with-me/'],
    ['/introduction', '/framework/'],
    ['/foundation-polyvagal', '/framework/polyvagal-theory/'],
    /* Retired as independent philosophy pages: Authorship is now a principle
       inside Participation, and Capacity and load is a section inside Nervous
       system regulation. The old URLs keep working. */
    ['/framework/authorship', '/framework/participation/'],
    ['/framework/capacity', '/framework/regulation/'],
    ['/new-page-1', '/framework/somatic-experiencing/'],
    ['/glossary', '/framework/glossary/'],
    ['/blog', '/essays/'],
    ['/blog/why-dating-feels-exhausting', '/essays/why-dating-feels-exhausting/'],
    ['/blog/the-first-principles-of-life-coaching', '/essays/first-principles-of-life-coaching/'],
    ['/blog/standing-on-the-backs-of-giants', '/essays/standing-on-the-backs-of-giants/'],
  ];

  /* Guard against reintroducing a self-shadowing rule: a source that matches a
     path this build actually emits would hide that page. */
  const emitted = new Set(
    pages.map((p) => '/' + p.path.replace(/index\.html$/, '').replace(/\/$/, ''))
  );
  for (const [from] of map) {
    const key = from.replace(/\/$/, '') || '/';
    if (emitted.has(key)) {
      throw new Error(
        `_redirects: source "${from}" matches a page this site serves ` +
        `("${key}"). On Cloudflare Pages the redirect would shadow that page.`
      );
    }
  }

  const lines = [
    '# Legacy Squarespace URLs → new structure.',
    '# Cloudflare Pages applies these before serving static assets, so no source',
    '# below may match a path this site actually serves.',
    '',
  ];
  for (const [from, to] of map) lines.push(`${from}  ${to}  301`);
  return lines.join('\n') + '\n';
}

function buildHeaders() {
  return `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), camera=(), microphone=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/styles.css
  Cache-Control: public, max-age=3600

/site.js
  Cache-Control: public, max-age=3600
`;
}

function buildFavicon() {
  /* Wordmark favicon in the brand navy — a generated placeholder, replaceable. */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Fareed Quraishi">
  <rect width="64" height="64" fill="#253551"/>
  <text x="32" y="43" font-family="Georgia, serif" font-size="34" fill="#f4f2ec" text-anchor="middle">F</text>
</svg>
`;
}

/* =========================================================================
   checks
   ========================================================================= */

/* Names retired by the Authentic Manifestation rebuild. Keeping the list here
   means a stray mention in new copy fails `--check` instead of shipping. */
const STALE_TERMS = [
  'Nervous System & Authorship',
  'Nervous System and Authorship',
  'Regulation → Capacity → Authorship',
  'Somatic coach',
];

/* Phrases that must not reappear on a published page. Each one is a promise the
   site does not currently make: a free conversation, a same-week reply, a
   quantifiable number of open places, or an immediate start. */
const COPY_RULES = [
  { re: /\bno cost\b/i, why: 'promises something at no cost', allowNegation: true },
  { re: /\bcomplimentary\b/i, why: 'promises a complimentary call', allowNegation: true },
  { re: /\bfree (introductory|intro|consultation|consult|call|chat)\b/i, why: 'offers a free conversation', allowNegation: true },
  { re: /\bwithin a few days\b|\busually within a few\b/i, why: 'use the "three business days" response expectation' },
  { re: /\b(places?|spots?)\s+(remaining|left)\b/i, why: 'quantifies remaining availability' },
  { re: /\b\d+ (places?|spots?) (are )?(still )?(open|available)\b/i, why: 'quantifies open places' },
  { re: /\b(book|schedule) (a session )?(now|today|immediately)\b/i, why: 'promises immediate scheduling' },
  { re: /\blimited (time|spots|places)\b/i, why: 'uses scarcity marketing' },
  { re: /\bnext available\b/i, why: 'claims immediate availability' },
];

/* Apply COPY_RULES to a block of human-readable text. Messages injected by
   site.js are checked with the same rules, so a promise can no longer be
   reintroduced by editing a string in the script. */
function copyProblems(text, where) {
  const found = [];
  for (const rule of COPY_RULES) {
    for (const m of text.matchAll(new RegExp(rule.re.source, 'gi'))) {
      /* A negated mention is the opposite of a promise: "there is no
         complimentary introductory call" is a sentence the site should be
         allowed to write. */
      if (rule.allowNegation) {
        const before = text.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
        if (/(\bno\b|\bnot\b|n't|\bwithout\b|\bnothing\b|\bnever\b)[^.!?]{0,26}$/.test(before)) continue;
      }
      found.push(`${where}: ${rule.why} ("${m[0]}")`);
      break;
    }
  }
  return found;
}

/* site.js carries the success message and the error messages the visitor reads.
   They are strings in a script, so the page scan cannot see them; this pulls
   every single-quoted string out and runs the same copy rules over them. */
function collectScriptChecks(source) {
  /* Both quote styles: messages a visitor reads are single-quoted in the
     script, but anything passed through JSON.stringify is double-quoted. */
  const messages = [...source.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => (m[1] !== undefined ? m[1] : m[2]))
    .join(' \n ');
  return copyProblems(messages, 'site.js');
}

function collectChecks(siteJsSource) {
  const problems = [];
  const paths = new Set(pages.map((p) => p.path));

  const resolve = (href) => {
    if (!href.startsWith('/')) return null;
    if (href.startsWith('//')) return null;
    const [pathOnly] = href.split('#');
    if (/\.(webp|jpg|jpeg|png|svg|css|js|xml|txt|ico|woff2)$/i.test(pathOnly)) return null;
    let p = pathOnly.replace(/^\//, '');
    if (p === '' || p.endsWith('/')) p += 'index.html';
    return p;
  };

  for (const { path, html } of pages) {
    /* internal links */
    for (const m of html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) {
      const target = resolve(m[1]);
      if (target === null) continue;
      if (!paths.has(target)) {
        problems.push(`${path}: link to "${m[1]}" has no target (expected ${target})`);
      }
    }
    /* images need alt text */
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      if (!/\balt="/.test(m[0])) problems.push(`${path}: <img> without alt attribute`);
      if (!/\bwidth="/.test(m[0]) || !/\bheight="/.test(m[0])) {
        problems.push(`${path}: <img> without width/height (layout shift): ${m[0].slice(0, 90)}`);
      }
    }
    /* exactly one h1 */
    const h1s = (html.match(/<h1[\s>]/g) || []).length;
    if (h1s !== 1) problems.push(`${path}: expected exactly one <h1>, found ${h1s}`);

    /* One call to action, one wording. Every primary button that points at the
       onboarding form has to carry the same label, wherever it appears. */
    for (const m of html.matchAll(/<a class="(?:nav__cta|btn[^"]*)" href="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
      if (m[1] !== START.href) continue;
      const label = m[2].trim();
      if (label !== START.label) {
        problems.push(`${path}: call to action reads "${label}", expected "${START.label}"`);
      }
    }
    /* heading order */
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        problems.push(`${path}: heading level jumps h${levels[i - 1]} → h${levels[i]}`);
        break;
      }
    }
    /* title and description present and sane */
    const title = html.match(/<title>([^<]*)<\/title>/);
    if (!title || title[1].length < 10) problems.push(`${path}: missing or too-short <title>`);
    const desc = html.match(/<meta name="description" content="([^"]*)"/);
    if (!desc || desc[1].length < 50) problems.push(`${path}: missing or too-short meta description`);
    if (desc && desc[1].length > 320) problems.push(`${path}: meta description is ${desc[1].length} chars (over 320)`);

    /* The framework was rebuilt on the Authentic Manifestation architecture.
       These are the old names, and they must not creep back in — including in
       titles and meta descriptions, where a visitor is not the only reader. */
    const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
    const meta = [...html.matchAll(/<title>([^<]*)<\/title>/g), ...html.matchAll(/content="([^"]*)"/g)]
      .map((m) => m[1]).join(' ') + ' ' + text;
    for (const stale of STALE_TERMS) {
      if (meta.includes(stale)) problems.push(`${path}: stale framework terminology — "${stale}"`);
    }

    /* The pilot cohort size is a business fact in content/offer.json. Copy that
       states it in words has to agree with the number there. The noun list is
       deliberately narrow: "two people" in an ordinary sentence is not a claim
       about the cohort, "two clients" or "two people who want to explore" is. */
    for (const word of NUMBER_WORDS.slice(1)) {
      if (word === pilotCapacity()) continue;
      for (const phrase of [`${word} clients`, `${word} places`, `${word} people who`]) {
        if (text.includes(phrase)) {
          problems.push(
            `${path}: "${phrase}" disagrees with offer.pilot.capacity (${offer.pilot.capacity} → "${pilotCapacity()}")`
          );
        }
      }
    }

    /* Copy rules — see COPY_RULES above. Checked against the visible text, so
       attribute values and scripts cannot produce a false positive. */
    problems.push(...copyProblems(text, path));

    /* Archived essays stay reachable by direct link but are not promoted: no
       page outside the essay archive may link to them. */
    if (!path.startsWith('essays/')) {
      for (const m of html.matchAll(/href="(\/essays[^"]*)"/g)) {
        problems.push(`${path}: links to archived essay "${m[1]}" — the archive is not promoted from the site`);
      }
    }

    /* Every price printed on the site has to come from content/offer.json. */
    for (const m of text.matchAll(/\$([0-9]+)(?:\.[0-9]{2})?/g)) {
      const amount = Number(m[1]);
      const known = offer.knownAmounts;
      if (!known.includes(amount)) {
        problems.push(`${path}: price "$${amount}" is not in content/offer.json (${known.join(', ')})`);
      }
    }
  }

  problems.push(...collectScriptChecks(siteJsSource));

  return problems;
}

/* =========================================================================
   write
   ========================================================================= */

function copyDir(from, to) {
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dest = join(to, entry);
    if (statSync(src).isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyDir(src, dest);
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }
}

/* --- run ----------------------------------------------------------------- */

const frameworkDocs = loadFramework();
const essays = loadEssays();

buildHome();
buildCoaching();
buildAbout();
buildPrivacy();
buildFramework(frameworkDocs);
buildEssays(essays);
buildWorkWithMe();
buildOnboarding();
build404();

/* Generated once: written to dist/, and scanned for copy the page checks cannot
   see. */
const siteJsSource = buildSiteJs(readJSON(join(CONTENT, 'onboarding.json')).onboarding);

const problems = collectChecks(siteJsSource);

if (CHECK) {
  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s):\n`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`✓ checks passed (${pages.length} pages)`);
  process.exit(0);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const { path, html } of pages) {
  const dest = join(DIST, path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
}

copyDir(PUBLIC, DIST);
mkdirSync(join(DIST, 'assets'), { recursive: true });
copyFileSync(join(SRC, 'styles.css'), join(DIST, 'styles.css'));
writeFileSync(join(DIST, 'site.js'), siteJsSource);
writeFileSync(join(DIST, 'sitemap.xml'), buildSitemap(pages.map((p) => p.path)));
writeFileSync(join(DIST, 'robots.txt'), buildRobots());
writeFileSync(join(DIST, '_redirects'), buildRedirects());
writeFileSync(join(DIST, '_headers'), buildHeaders());
writeFileSync(join(DIST, 'favicon.svg'), buildFavicon());

/* Note: functions/ is NOT copied into dist/. Cloudflare Pages reads
   /functions from the repository root and builds it separately from the
   static output directory. */

console.log(`✓ built ${pages.length} pages into dist/`);
if (problems.length) {
  console.log(`\n⚠ ${problems.length} content warning(s) — run "node build.mjs --check" for detail:`);
  for (const p of problems.slice(0, 15)) console.log('  - ' + p);
}

/* Business decisions that are still open. They are deliberately absent from the
   published pages: publishing an invented cancellation policy would be worse
   than publishing none. See REVIEW.md for the full list. */
if (unconfirmedPolicies.length) {
  console.log(`\n⚠ ${unconfirmedPolicies.length} business policy/policies still to confirm before launch:`);
  for (const p of unconfirmedPolicies) console.log('  - ' + p);
}
