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
  { label: 'About', href: '/about/' },
  { label: 'Framework', href: '/framework/' },
  { label: 'Work with me', href: '/work-with-me/' },
];

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
      html: markdown(body),
    });
  }

  for (const file of readDirFiles(dir, ['.json'])) {
    const d = readJSON(file);
    const slug = d.slug || slugOf(file);
    docs.push({
      kind: 'glossary', slug,
      title: d.heading || 'Glossary', heading: d.heading,
      metaTitle: d.metaTitle, metaDescription: d.metaDescription,
      lede: d.lede, standfirst: d.standfirst,
      order: Number(d.order || 99),
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
      <a class="nav__cta" href="/work-with-me/#inquiry">Start a conversation</a>
    </nav>
  </div>
</header>`;
}

function footer() {
  return `
<footer class="footer">
  <div class="wrap footer__inner">
    <div class="footer__top">
      <div class="footer__brand">
        <p class="footer__name">Fareed Quraishi</p>
        <p class="footer__blurb">Somatic coaching for nervous-system regulation, capacity, and self-authorship.</p>
      </div>
      <div>
        <p class="footer__h">This site</p>
        <ul>
          <li><a href="/coaching/">Coaching</a></li>
          <li><a href="/about/">About</a></li>
          <li><a href="/work-with-me/">Work with me</a></li>
          <li><a href="/essays/">Essays</a></li>
        </ul>
        <p class="footer__h footer__h--sub">Also</p>
        <ul>
          <li><a class="footer__ext" href="https://therapeuticrelationship.org" target="_blank" rel="noopener external">The Therapeutic Relationship<span class="external-mark" aria-hidden="true">&#8599;</span></a></li>
        </ul>
      </div>
      <div>
        <p class="footer__h">Framework</p>
        <ul>
          <li><a href="/framework/">Introduction</a></li>
          <li><a href="/framework/regulation/">Regulation</a></li>
          <li><a href="/framework/capacity/">Capacity</a></li>
          <li><a href="/framework/authorship/">Authorship</a></li>
          <li><a href="/framework/glossary/">Glossary</a></li>
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
      <p>&copy; ${new Date().getFullYear()} Fareed Quraishi</p>
    </div>
  </div>
</footer>
<script src="/site.js" defer></script>
</body>
</html>`;
}

/* Small progressive enhancement: mobile nav + inquiry form. The site is fully
   functional and readable without it. */
const SITE_JS = `/* FareedQ.com — progressive enhancement only. */
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

  /* ---- inquiry form ----------------------------------------------------- */
  var form = document.querySelector('[data-inquiry-form]');
  if (!form) return;

  var status = form.querySelector('[data-form-status]');
  var button = form.querySelector('button[type="submit"]');
  var startedAt = Date.now();

  function show(state, message) {
    if (!status) return;
    status.setAttribute('data-state', state);
    status.setAttribute('data-visible', 'true');
    status.textContent = message;
  }

  function setFieldError(input, message) {
    var box = document.getElementById(input.id + '-error');
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      if (box) { box.textContent = message; box.setAttribute('data-visible', 'true'); }
    } else {
      input.removeAttribute('aria-invalid');
      if (box) { box.textContent = ''; box.setAttribute('data-visible', 'false'); }
    }
  }

  function validate() {
    var ok = true;
    var firstBad = null;

    var name = form.elements.name;
    if (name && !name.value.trim()) {
      setFieldError(name, 'Please enter your name.'); ok = false; firstBad = firstBad || name;
    } else if (name) { setFieldError(name, ''); }

    var email = form.elements.email;
    if (email) {
      var value = email.value.trim();
      if (!value) { setFieldError(email, 'Please enter your email address.'); ok = false; firstBad = firstBad || email; }
      else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(value)) {
        setFieldError(email, 'That does not look like an email address.'); ok = false; firstBad = firstBad || email;
      } else { setFieldError(email, ''); }
    }

    var msg = form.elements.message;
    if (msg && msg.value.length > 4000) {
      setFieldError(msg, 'Please keep this under 4000 characters.'); ok = false; firstBad = firstBad || msg;
    } else if (msg) { setFieldError(msg, ''); }

    if (firstBad) firstBad.focus();
    return ok;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) { show('error', 'Please check the highlighted fields.'); return; }

    var payload = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      message: form.elements.message ? form.elements.message.value.trim() : '',
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
          show('success', 'Thank you — your message has reached me. I read every one myself and will reply personally to the address you gave, usually within a few days. If you do not hear back, check your spam folder.');
          if (status) status.focus();
        } else {
          var m = (r.body && r.body.error) || 'Something went wrong and your message was not sent.';
          show('error', m + ' You can also email me directly at ${site.email}.');
          if (status) status.focus();
        }
      })
      .catch(function () {
        show('error', 'Your message could not be sent — this is usually a connection problem. Please try again, or email me directly at ${site.email}.');
        if (status) status.focus();
      })
      .then(function () {
        if (button) { button.removeAttribute('aria-busy'); button.disabled = false; }
      });
  });

  /* Clear a field error as soon as the person corrects it. */
  ['name', 'email', 'message'].forEach(function (key) {
    var field = form.elements[key];
    if (!field) return;
    field.addEventListener('input', function () {
      if (field.getAttribute('aria-invalid') === 'true') setFieldError(field, '');
    });
  });
})();
`;

/* =========================================================================
   components
   ========================================================================= */

const motif = (steps) => `
      <div class="motif">
${steps.map((s) => `        <article class="motif__step">
          <p class="motif__n">${esc(s.n)}</p>
          <div>
            <h3 class="motif__name">${esc(s.name)}</h3>
            <p class="motif__summary">${inline(s.summary)}</p>
${s.body ? `            <p class="motif__body">${inline(s.body)}</p>` : ''}
          </div>
        </article>`).join('\n')}
      </div>`;

const motifBar = () => `
      <p class="motif-bar">
        <span class="motif-bar__item"><span class="motif-bar__swatch" style="background:var(--step-1)"></span>Regulation</span>
        <span class="motif-bar__arrow" aria-hidden="true">&rarr;</span>
        <span class="motif-bar__item"><span class="motif-bar__swatch" style="background:var(--step-2)"></span>Capacity</span>
        <span class="motif-bar__arrow" aria-hidden="true">&rarr;</span>
        <span class="motif-bar__item"><span class="motif-bar__swatch" style="background:var(--step-3)"></span>Authorship</span>
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
    jobTitle: 'Somatic coach',
    description: site.description,
    knowsAbout: ['Nervous system regulation', 'Somatic coaching', 'Polyvagal theory', 'Somatic Experiencing', 'Self-authorship'],
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
        <div class="hero__paths">
          <a class="hero__path" href="/work-with-me/#inquiry">
            <strong>Start a conversation</strong>
            <span>A short message, read by me. No booking, no obligation.</span>
          </a>
        </div>
      </div>
      <figure class="hero__figure">
        <img class="hero__img" src="${h.image.src}" srcset="${h.image.srcset}" sizes="(max-width: 900px) 100vw, 42vw" width="${h.image.width}" height="${h.image.height}" alt="${esc(h.image.alt)}" fetchpriority="high" decoding="async" />
      </figure>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="problem-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.problem.label)}</p>
          <h2 class="h2 mt-2" id="problem-title">${esc(home.problem.title)}</h2>
        </div>
        <div class="prose">
${home.problem.paragraphs.map((p) => `          <p>${inline(p)}</p>`).join('\n')}
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
          <p><a class="text-link" href="/framework/">Read the framework in full</a></p>
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
      <div class="mt-5">
${listComponent(home.work.items)}
      </div>
      <div class="mt-4">
        <div class="callout callout--quiet">
          <p>${inline(home.work.note)} <a class="text-link" href="/work-with-me/#scope">Read the scope of practice</a>.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" aria-labelledby="about-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.about.label)}</p>
        </div>
        <div>
          <h2 class="h2" id="about-title">${esc(home.about.title)}</h2>
          <div class="prose mt-3">
${home.about.paragraphs.map((p) => `            <p>${inline(p)}</p>`).join('\n')}
          </div>
          <p class="mt-3"><a class="text-link" href="${home.about.link.href}">${esc(home.about.link.label)}</a></p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="explore-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.explore.label)}</p>
          <h2 class="h2 mt-2" id="explore-title">${esc(home.explore.title)}</h2>
          <p class="lede mt-3">${inline(home.explore.body)}</p>
        </div>
        <div>
${motifBar()}
          <div class="doorway mt-4">
${home.explore.links.map((l) => `            <a class="doorway__item" href="${l.href}">
              <span class="doorway__label">${esc(l.label)}</span>
              <span class="doorway__note">${esc(l.note)}</span>
            </a>`).join('\n')}
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--deep project" aria-labelledby="project-title">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(home.project.label)}</p>
          <h2 class="h2 mt-2" id="project-title">${esc(home.project.title)}</h2>
        </div>
        <div>
          <div class="prose">
${home.project.paragraphs.map((p) => `            <p>${inline(p)}</p>`).join('\n')}
          </div>
          <p class="project__link-wrap mt-4">
            <a class="project__link" href="${home.project.link.href}" target="_blank" rel="noopener external">
              <span class="project__link-label">${esc(home.project.link.label)}</span>
              <span class="external-mark" aria-hidden="true">&#8599;</span>
            </a>
            <span class="project__link-meta">${esc(home.project.link.url)} &middot; ${esc(home.project.link.note)}</span>
          </p>
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
${footer()}`;

  page('index.html', html);
}

/* ------------------------------------------------------------ coaching --- */

function buildCoaching() {
  const c = readJSON(join(CONTENT, 'coaching.json')).coaching;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Somatic coaching',
    serviceType: 'Personal development coaching',
    description: c.metaDescription,
    provider: { '@type': 'Person', name: site.name, url: SITE_URL },
    areaServed: 'Online',
    url: `${SITE_URL}/coaching/`,
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
          <h1 class="h2 mt-2" style="font-size:var(--fs-display);line-height:1.08;letter-spacing:var(--tracking-display)">${esc(c.intro.title)}</h1>
        </div>
        <div>
          <p class="lede">${inline(c.intro.lede)}</p>
          <p class="mt-4"><a class="btn btn--ink" href="${c.intro.action.href}">${esc(c.intro.action.label)}</a></p>
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
          <h2 class="h2" id="who-title">${esc(c.who.title)}</h2>
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

  <section class="band band--warm" aria-labelledby="explore-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="explore-title">${esc(c.explore.title)}</h2>
          <p class="lede mt-3">${inline(c.explore.intro)}</p>
        </div>
        <div>
${listComponent(c.explore.items)}
        </div>
      </div>
    </div>
  </section>

  <section class="band band--paper" aria-labelledby="session-title">
    <div class="wrap">
      <div class="split">
        <div><h2 class="h2" id="session-title">${esc(c.session.title)}</h2></div>
        <div class="prose">
${c.session.paragraphs.map((p) => `          <p>${inline(p)}</p>`).join('\n')}
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

  <section class="band band--warm" aria-labelledby="fees-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="fees-title">${esc(c.fees.title)}</h2>
          <p class="quiet mt-2">${esc(c.fees.note)}</p>
        </div>
        <div>
          <dl class="list" style="display:grid;gap:0;list-style:none">
${c.fees.items.map((i) => `            <div style="border-bottom:1px solid var(--rule);padding-block:0.95rem;max-width:var(--measure)">
              <dt class="list__name">${esc(i.label)}</dt>
              <dd class="list__body" style="margin:0.35rem 0 0">${inline(i.value)}</dd>
            </div>`).join('\n')}
          </dl>
        </div>
      </div>
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
${footer()}`;

  page('coaching/index.html', html);
}

/* --------------------------------------------------------------- about --- */

function buildAbout() {
  const { data, body } = parseFrontmatter(readFileSync(join(CONTENT, 'pages', 'about.md'), 'utf8'));

  const html = `${head({
    title: data.metaTitle, description: data.metaDescription, path: '/about/', ogType: 'profile',
  })}
${masthead({ current: '/about/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">${esc(data.title)}</p>
      <h1 class="mt-2">${esc(data.heading)}</h1>
      <p class="lede">${esc(data.lede)}</p>
      <p class="standfirst">${esc(data.standfirst)}</p>
    </div>
  </section>

  <section class="band band--paper">
    <div class="wrap">
      <div class="prose" style="margin-inline:auto">
${markdown(body)}
      </div>
      <div class="mt-5" style="max-width:var(--measure)">
        <div class="callout">
          <p>Interested in working together? <a class="text-link" href="/work-with-me/">Start a conversation</a> — or read about <a class="text-link" href="/coaching/">what coaching involves</a>.</p>
        </div>
      </div>
    </div>
  </section>
</main>
${footer()}`;

  page('about/index.html', html);
}

/* ----------------------------------------------------------- framework --- */

function buildFramework(docs) {
  const index = docs[0];
  const rest = docs.slice(1);

  const fwNav = (currentSlug) => `
        <nav class="fw-aside" aria-label="Framework">
          <p class="fw-aside__title">The framework</p>
          <ul>
${docs.map((d) => `            <li><a href="/framework/${d.slug === 'introduction' ? '' : d.slug + '/'}"${d.slug === currentSlug ? ' aria-current="page"' : ''}>${esc(d.title)}</a></li>`).join('\n')}
          </ul>
        </nav>`;

  /* --- index ------------------------------------------------------------ */
  const indexHtml = `${head({
    title: index.metaTitle, description: index.metaDescription, path: '/framework/',
  })}
${masthead({ current: '/framework/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">Framework</p>
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
            <p class="toc__title">In this framework</p>
            <ul>
${docs.map((d, i) => `              <li><a href="#${d.slug}">${i + 1}. ${esc(d.title)}</a></li>`).join('\n')}
            </ul>
          </nav>
        </aside>
        <div>
          <div class="prose">
${index.html}
          </div>

          <div class="mt-5">
            <h2 class="h2" style="font-size:var(--fs-h3)">The three layers</h2>
${motif([
  { n: '01', name: 'Regulation', summary: 'The ability to move flexibly between activation and rest without losing yourself. Not calmness — adaptability.' },
  { n: '02', name: 'Capacity', summary: 'How much life your system can hold without collapsing or going numb. Capacity fluctuates daily.' },
  { n: '03', name: 'Authorship', summary: 'The ability to shape your life rather than only react to it. Authorship emerges when the first two are stable.' },
])}
          </div>

          <div class="mt-5">
            <h2 class="h2" style="font-size:var(--fs-h3)">Read the framework</h2>
            <ul class="fw-nav mt-3">
${docs.map((d, i) => `              <li id="${d.slug}"><a href="/framework/${d.slug === 'introduction' ? '' : d.slug + '/'}">
                <span>
                  <span class="fw-nav__title">${esc(d.title)}</span>
                  <span class="fw-nav__note">${esc(d.lede ? d.lede.slice(0, 118) + '…' : '')}</span>
                </span>
                <span class="fw-nav__order">${String(i + 1).padStart(2, '0')}</span>
              </a></li>`).join('\n')}
            </ul>
          </div>

          <div class="mt-5" style="max-width:var(--measure)">
            <div class="callout callout--quiet">
              <p>These are working ideas rather than settled doctrine. They are grounded in research and clinical work by others — <a class="text-link" href="/essays/standing-on-the-backs-of-giants/">the lineage is worth naming</a> — and they will keep being refined.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
${footer()}`;

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
      isPartOf: { '@type': 'CreativeWorkSeries', name: 'The Nervous System & Authorship Framework', url: `${SITE_URL}/framework/` },
    });

    const html = `${head({
      title: doc.metaTitle, description: doc.metaDescription, path, ogType: 'article', jsonLd,
    })}
${masthead({ current: '/framework/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">Framework${isGlossary ? '' : ` &middot; ${readingTime(doc.html)} min read`}</p>
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
          <div class="prose">
${anchored}
          </div>
${toc}
          <div class="mt-5" style="max-width:var(--measure)">
            <div class="callout">
              <p><strong>The framework is the basis of the coaching.</strong> If reading this raised something you would like to work on, that is what the coaching is for.</p>
              <p><a class="text-link" href="/coaching/">What coaching involves</a> &middot; <a class="text-link" href="/work-with-me/">Start a conversation</a></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
${footer()}`;

    page(`${path.slice(1)}index.html`, html);
  }
}

/* -------------------------------------------------------------- essays --- */

function buildEssays(essays) {
  const indexHtml = `${head({
    title: 'Essays — Fareed Quraishi',
    description: 'Occasional writing on nervous-system regulation, relational patterns, and the scope of coaching practice.',
    path: '/essays/',
  })}
${masthead({ current: '/essays/' })}

<main id="main">
  <section class="page-head band--paper">
    <div class="wrap page-head__inner">
      <p class="label">Essays</p>
      <h1 class="mt-2">Writing</h1>
      <p class="lede">Occasional pieces rather than a blog — long enough to develop an argument, and written to be read slowly.</p>
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
${footer()}`;

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
      <div class="prose" style="margin-inline:auto">
${anchored}
      </div>
      <hr class="rule mt-5" style="max-width:var(--measure)" />
      <p class="mt-3"><a class="text-link" href="/essays/">&larr; All writing</a></p>
    </div>
  </section>
</main>
${footer()}`;

    page(`${path.slice(1)}index.html`, html);
  }
}

/* -------------------------------------------------------- work with me --- */

function buildWorkWithMe() {
  const w = readJSON(join(CONTENT, 'work-with-me.json')).workWithMe;

  const html = `${head({
    title: w.metaTitle, description: w.metaDescription, path: '/work-with-me/',
    noindex: false,
  })}
${masthead({ current: '/work-with-me/' })}

<main id="main">
  <section class="band band--paper">
    <div class="wrap">
      <div class="split">
        <div>
          <p class="label">${esc(w.intro.eyebrow)}</p>
          <h1 class="h2 mt-2" style="font-size:var(--fs-display);line-height:1.08;letter-spacing:var(--tracking-display)">${esc(w.intro.title)}</h1>
        </div>
        <div>
          <p class="lede">${inline(w.intro.lede)}</p>
          <p class="quiet mt-3">${esc(w.intro.note)}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--warm" id="inquiry" aria-labelledby="form-title">
    <div class="wrap">
      <div class="split">
        <div>
          <h2 class="h2" id="form-title">${esc(w.form.title)}</h2>
          <p class="lede mt-3">${inline(w.form.lede)}</p>

          <div class="mt-5">
            <p class="label">What happens next</p>
${processList(w.how.steps)}
          </div>
        </div>

        <div>
          <form class="form" method="POST" action="/api/inquiry" data-inquiry-form novalidate>
            <div class="field">
              <label for="name">${esc(w.form.fields.name.label)} <span class="req" aria-hidden="true">*</span></label>
              <input type="text" id="name" name="name" autocomplete="name" required aria-describedby="name-error" />
              <p class="field__error" id="name-error" data-visible="false" role="alert"></p>
            </div>

            <div class="field">
              <label for="email">${esc(w.form.fields.email.label)} <span class="req" aria-hidden="true">*</span>
                <span class="hint">${esc(w.form.fields.email.hint)}</span>
              </label>
              <input type="email" id="email" name="email" autocomplete="email" required aria-describedby="email-error" />
              <p class="field__error" id="email-error" data-visible="false" role="alert"></p>
            </div>

            <div class="field">
              <label for="message">${esc(w.form.fields.message.label)}
                <span class="hint">${esc(w.form.fields.message.hint)}</span>
              </label>
              <textarea id="message" name="message" rows="6" maxlength="4000" aria-describedby="message-error"></textarea>
              <p class="field__error" id="message-error" data-visible="false" role="alert"></p>
            </div>

            <div class="hp" aria-hidden="true">
              <label for="company">Company</label>
              <input type="text" id="company" name="company" tabindex="-1" autocomplete="off" />
            </div>

            <p class="form__consent">${esc(w.form.consent)}</p>
            <p class="form__consent">${esc(w.form.privacyNote)}</p>

            <div class="form__actions">
              <button class="btn btn--ink" type="submit">${esc(w.form.submit)}</button>
            </div>

            <p class="form__status" data-form-status data-visible="false" tabindex="-1" role="status" aria-live="polite"></p>
          </form>
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

  <section class="band band--navy">
    <div class="wrap">
      <div class="split">
        <div><h2 class="h2">Not sure yet?</h2></div>
        <div>
          <p class="lede">You do not need to know what you want to work on in order to get in touch. A short message saying you are curious is a perfectly good first step.</p>
          <p class="mt-4"><a class="btn btn--primary" href="#inquiry">Go to the form</a></p>
        </div>
      </div>
    </div>
  </section>
</main>
${footer()}`;

  page('work-with-me/index.html', html);
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
          <li><a href="/framework/"><span><span class="fw-nav__title">The framework</span><span class="fw-nav__note">Regulation, capacity, and authorship.</span></span></a></li>
          <li><a href="/work-with-me/"><span><span class="fw-nav__title">Start a conversation</span><span class="fw-nav__note">A short message, read by me.</span></span></a></li>
        </ul>
      </div>
    </div>
  </section>
</main>
${footer()}`;

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
    ['/contact', '/work-with-me/'],
    /* No fragment in the source: fragments are evaluated by the browser and
       never reach Cloudflare, so a source fragment would simply not match.
       Fragments *are* allowed in destinations, but pointing at the page is
       better than pointing at an anchor, since the scope section is linked
       from the top of it. */
    ['/scope-of-practice', '/work-with-me/'],
    ['/introduction', '/framework/'],
    ['/foundation-polyvagal', '/framework/polyvagal-theory/'],
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

function collectChecks() {
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
  }

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
buildFramework(frameworkDocs);
buildEssays(essays);
buildWorkWithMe();
build404();

const problems = collectChecks();

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
writeFileSync(join(DIST, 'site.js'), SITE_JS);
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
