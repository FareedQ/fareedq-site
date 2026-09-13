# Review notes — FareedQ.com rebuild

Written after Phases 1–3. **This file is a report, not part of the site.** Delete
it once you have worked through the decisions below.

---

## 1. What I found on the existing site (Phase 1 audit)

### Pages that exist today

| URL | Title | What it actually is |
| --- | --- | --- |
| `/home` | Fareed Quraishi | Full-bleed navy hero, one photograph, a paragraph of intro, two buttons |
| `/about-me` | Founder Story | ~700 words of autobiography. The strongest content on the site |
| `/services-offered` | Services | Four service blocks, an approach section, a "who this is for" list |
| `/contact` | Let's Work Together | A four-field Squarespace form, no page copy |
| `/scope-of-practice` | Scope of Practice | A careful statement of coaching boundaries |
| `/introduction` (also `/framework`) | An Introduction | The Nervous System & Authorship framework |
| `/foundation-polyvagal` | Foundation: Polyvagal | Polyvagal theory explainer |
| `/new-page-1` | Foundation: Somatic Experiencing | Somatic Experiencing explainer. **Never renamed from the default Squarespace slug** |
| `/glossary` | Glossary | ~30 defined terms in 8 groups |
| `/blog` + 3 posts | Blog | "Why Dating Feels Exhausting", "First Principles: Life Coaching", "Standing on the Backs of Giants" |

### Visual language, measured rather than guessed

Extracted from the rendered pages via the Chrome DevTools Protocol:

- **Type.** Headings: Verdana 600 at 66.4 / 49.6 / 34.5 / 24.4 px. Body:
  Georgia 400 at 21.04 px, letter-spacing −0.03em, line-height 1.6.
- **Colour.** Deep navy `rgb(37,53,81)` — the hero background, and the only
  brand colour. Warm off-white `rgb(224,224,219)` — the page field. Otherwise
  black on white. There is no accent colour.
- **Rhythm.** A 1200px full-bleed hero, then a 439px footer band. Content
  sections sit on white with no dividers.
- **Photography.** Exactly **one** real photograph on the whole site:
  `Jacket.JPG` (2500×2261, a portrait out of doors in a jacket under open sky).
  It is used only as the homepage hero. The blog index carries three
  **AI-generated** thumbnails (`ChatGPT Image Mar 5, 2026…`). `scope-of-practice`
  references a fourth image. There is no personal photography beyond the hero.
- **Line length.** The most important finding. The old site sets body text at
  21px across a **1367px** column, which produces **76 to 104 characters per
  line**. That is the single biggest readability problem, and it is why the
  long framework pages are tiring to read.

### Strongest elements (all preserved)

1. The voice. Precise, unhurried, a little contrarian, unafraid of long
   sentences. Closer to an essayist than a marketer.
2. **Regulation → Capacity → Authorship.** A genuinely good model with its own
   vocabulary. This is the differentiator and it now leads the homepage.
3. The glossary. Real, specific, oddly confident terms — *clean desire*,
   *obligation-triggered desire collapse*, *future policing*, *exit agency*,
   *Minimal Viable Life*. Nothing generic about it.
4. The About page's opening line, and the systems-thinking-to-human-systems arc.
5. Genuine intellectual honesty about lineage: Porges, Levine, Dana are named
   and credited repeatedly.

### Weakest elements (addressed)

1. **Ten top-level nav items**, two of which were folders, and "Framework"
   dominated everything. The framework obscured the service.
2. **Nothing on the site said what you could hire him for.** `/services-offered`
   described modalities, not an offer.
3. **Verdana at 66px** for headings. It was the default Squarespace pairing and
   it looks like one.
4. `/new-page-1` is a live, indexable URL with a default slug.
5. Line length (above).
6. `/contact` was a form with a single heading. No copy at all.
7. The blog was three posts with no home in the navigation's logic — orphaned
   from the framework they actually belong to.

---

## 2. What I preserved

**Copy, largely intact.** The About page's story, the framework introduction,
both theory explainers, the glossary, all three essays, the scope of practice,
and the services descriptions are all carried over. I edited for consistency,
British/Canadian spelling, and the medical-scope boundary — not for tone. The
lines you asked me to keep are kept, including:

> For most of my career, I built systems for machines. Today, I help people
> understand the systems inside themselves.

It now opens the About page *and* the homepage's About section.

**The design identity.** The navy `#253551` and the warm off-white are carried
over as the two primary colours, with the off-white slightly warmed. **Georgia
is still the reading face** — it was the old site's body font and it does real
work. The editorial restraint, generous negative space, and the one-big-image
hero are all preserved.

**The vocabulary.** Every framework term survives verbatim.

**The photograph.** `Jacket.JPG` is now the hero, at three widths in WebP.

**The lineage.** Attribution to Porges and Levine appears on both theory pages,
in the framework introduction, and in the "Standing on the Backs of Giants" essay.

---

## 3. What I changed, and why

| Change | Reason |
| --- | --- |
| **10 nav items → 4** (Coaching, About, Framework, Work with me) | The brief. The framework now supports the practice instead of hiding it |
| **New `/coaching/` page** | The old site explained the thinking far better than the offer. This is the page that did not exist |
| **New `/work-with-me/`** with the enquiry form and scope of practice | A clear place to raise a hand; not a booking system |
| **Verdana → Archivo** for headings | The weakest visual element. Self-hosted, 34 kB, one variable file. Georgia stays |
| **Reading measure: 1367px / 21px → ~66 real characters** | The biggest usability fix. See `AGENTS.md` for why the `ch` unit is misleading |
| **Blog → "Essays"**, moved to `/essays/` | Your brief said no blog. They are framework-adjacent writing; they now sit under a quiet label rather than a dated feed |
| **Framework gets its own section** at `/framework/` with 7 pages | Discoverability and coherence. All existing concepts retained |
| **Scope of practice merged into `/work-with-me/#scope`** | It was a standalone page nobody would find. It belongs next to the form, where it does its job |
| **`/new-page-1` → `/framework/somatic-experiencing/`** with a 301 | Removes a default Squarespace slug from the public URL space |
| **Motif: Regulation → Capacity → Authorship** | The brief asked whether this could become a visual device. It is now a three-step bar (one warm hue through three lightness values, with a growing rule) on the homepage, framework index, and coaching page — and nowhere else |
| **Added a rust accent** `#8c4a2f` | Taken from the warm umber tones already present in the site's own photography. Used only for links, rules, and quote borders |
| **Default `p` max-width** | So no paragraph can silently run the width of the page again |

### Things I deliberately did *not* do

- No testimonials, no pricing tiers, no "book a discovery call" funnel, no
  urgency, no gradients, no cards, no stock imagery, no icon system.
- No medical, clinical, or outcome claims.
- No invented credentials, statistics, or testimonials. Where the old site was
  vague I made the About page *more* precise, not less.
- No DNS changes, no deployment, no touching the live site.

---

## 4. Content I flagged rather than repeated

Per your instruction, here is where the existing copy crossed the coaching
boundary, and what I did:

1. **Homepage (old):** *"With a background in community mental health,
   trauma-informed practice, and ongoing training in somatic and therapeutic
   frameworks…"* — "background in community mental health" reads as employment
   in a clinical service. In fact the About page describes **volunteering** with
   the CMHA. I rewrote this to match the About page's more accurate account.

2. **`/services-offered`, "Nervous System & Emotional Regulation":** *"Many
   people experience cycles of overwhelm, shutdown, or persistent anxiety
   without fully understanding why… build emotional resilience."* Naming
   persistent anxiety as something the service addresses edges toward implying
   treatment. Rewritten in the new coaching page as regulation and capacity
   work, without the clinical framing.

3. **`/services-offered`, "Embodied Coaching":** *"Rather than focusing only on
   thoughts or goals…"* — fine as written, but the surrounding page used
   "trauma-informed care" as a headline principle, which implies a clinical
   standard of care. The scope statement now carries that weight explicitly.

4. **`/introduction`:** the sentence *"Somatic Experiencing focuses on how the
   body processes stress and trauma and how regulation can be restored…"* is
   accurate as a description of Levine's modality, but on a coaching site it can
   read as a claim to practise it. The new page states plainly: *"I am not a
   Somatic Experiencing practitioner, and I do not practise trauma therapy."*

5. **"I have also completed trauma-informed training through Wilfrid Laurier
   University, which deeply informs the way I approach safety, care, and
   personal growth."** Kept, but now alongside an explicit statement of what
   that training does and does not license.

None of these were invented problems — they are the standard places a coaching
site drifts into healthcare language. The new `/work-with-me/#scope` section is
the canonical boundary that everything else defers to.

---

## 5. Removed or demoted

| Removed | Where it went |
| --- | --- |
| Three AI-generated blog thumbnails | Not carried over. They are generic AI imagery and added nothing. The essays are text-only, which suits them |
| The `Phone` field on the contact form | You asked for a minimal lead form. Name, email, optional message |
| The "Blog" nav item | Becomes "Essays" in the footer only |
| "Founder Story" as a heading | It reads as a startup. The page is now simply "About" |
| `scope-of-practice` as a standalone URL | Merged into `/work-with-me/#scope`, with a 301 |
| Dead navigation duplication (`/services` **and** `/services-offered`, `/framework` **and** `/introduction`) | One canonical URL each; both legacy paths 301 |
| **Nothing conceptual.** No framework term, explainer, or idea was dropped | |

---

## 6. Decisions I need from you

**1. Fees and format.** `/coaching/` has a "Practical details" block marked
`TO CONFIRM — not yet published`. It currently lists: one-to-one, online,
60 minutes, weekly or fortnightly, first call free. The fee line is a
placeholder. Either give me the numbers or delete the block.

**2. The email address.** I found `quraishifareed@gmail.com` in the old
Squarespace form configuration and used it. If you would rather use a
domain address (`hello@fareedq.com`) once the domain moves, that is a one-line
change in `content/site.json`.

**3. Social links.** The old site configured Instagram, TikTok, and YouTube —
all `@therapeutic.relationship` — but the social block does not render anywhere
I could find. I have put all three in the footer, linking with `rel="me"`.
**They may be placeholder accounts.** Please confirm they are ones you want
public, or I will remove them.

**4. Essays placement.** They currently live at `/essays/`, reachable from the
footer and from cross-links inside the framework. "First Principles: Life
Coaching" arguably belongs on the Coaching page instead, and "Standing on the
Backs of Giants" on the framework index. Say the word and I will inline them.

**5. The dating essay.** "Why Dating Feels Exhausting" is the most accessible
thing you have written and would likely be the strongest entry point for new
readers, but it currently sits three levels down. Consider surfacing it on the
homepage or under Coaching. I have left it where it is rather than making that
call for you.

**6. Homepage hero image.** The hero crops `Jacket.JPG` to a 4:5 portrait on
desktop and 3:2 on mobile. I could not view the photograph, so I chose a crop
that favours the upper third — reasonable for a standing portrait, but **please
look at it** and tell me if the framing is wrong. It is a one-line change.

---

## 7. Assets I need from you

**There is only one usable photograph on the entire existing site**, and it is
already in use. If you want the site to stay visually personal, I need more.

Requested, in priority order:

1. **Two or three more photographs of you**, ideally portrait orientation and
   with generous empty space around the subject. Any real setting. These would
   carry the About page, the Coaching page, and the Work With Me page, which are
   currently text-only.
2. **A real mark or wordmark**, if one exists. `favicon.svg` and
   `apple-touch-icon.png` are generated placeholders: a serif "F" on navy.
3. **Any existing photography you own** with a visual or textural quality —
   landscapes, rooms, objects. The design can absorb one or two without
   becoming a lifestyle blog.
4. **A decision on the three AI-generated thumbnails.** If you want them back I
   will add them, but I would not put image-generation artefacts on a site whose
   selling point is human, embodied work.

Drop files anywhere and tell me; I will convert, resize, and wire them in.

---

## 8. Enquiry form — what you need to set up

The form works today, in the sense that validation, error states, success state,
honeypot, timing check, and rate limiting are all implemented and tested. What
it cannot do yet is send email, because that needs an account and two secrets.

**Required — about ten minutes:**

1. Create a free account at [resend.com](https://resend.com) and generate an
   API key → this becomes **`RESEND_API_KEY`** (a Cloudflare *secret*).
2. Set **`INQUIRY_TO`** to wherever you want enquiries delivered.
3. In Resend, add and verify `fareedq.com` as a sending domain. Resend gives you
   SPF and DKIM records to add at your DNS provider. **These are for outbound
   mail only and are completely separate from pointing the website at Cloudflare
   Pages** — you can do this now without touching the live site.
4. Once verified, set **`INQUIRY_FROM`** to something like
   `FareedQ enquiries <enquiries@fareedq.com>`.

Without step 4 the default sender is Resend's shared test address, which only
delivers to the address that owns the Resend account. Fine for testing,
not for production.

All four variables go in **Cloudflare Pages → your project → Settings →
Variables and Secrets**, for both Production and Preview. Full detail in
`README.md`.

**Optional, only if spam becomes a problem:** a Turnstile key
(`TURNSTILE_SECRET_KEY`; the server-side verification is already written) and a
KV namespace bound as `INQUIRY_RATE_KV` for durable rate limiting.

**No database, no client-management system, no scheduler.** Nothing is stored —
enquiries exist only as email.

**Replacing this later** is deliberately cheap: change the form's `action` and
drop the `data-inquiry-form` attribute. No page markup, styling, or content has
to change, and `functions/api/inquiry.js` can just be deleted.

---

## 9. Verification I ran

All green at the time of writing:

- **Build:** 16 pages, zero warnings. Reproducible from a clean checkout with
  `node build.mjs` — there is nothing to install.
- **Content checks** (`node build.mjs --check`): every internal link resolves,
  alt text and `width`/`height` on every image, exactly one `h1` per page, no
  skipped heading levels, titles and meta descriptions present and in range.
- **Endpoint tests:** 29 passing — validation, honeypot, timing, spam heuristic,
  header-injection stripping, HTML escaping, missing-config fail-closed,
  upstream failure, malformed JSON, rate limiting, and KV-failure tolerance.
- **Layout:** 80 page × width combinations (16 pages × 1440/1024/768/390/320),
  no horizontal overflow, no oversized tap targets, no unlabelled controls, no
  duplicate IDs.
- **Contrast:** all 16 pages, every text/background pair computed from the
  rendered DOM, zero WCAG AA failures. The 16 measured ratios are recorded in
  the token block at the top of `src/styles.css`.
- **Reading measure:** every page lands between 29 and 70 real characters per
  line, against 76–104 on the old site. Checked with `tools/measure.js`, which
  counts characters on rendered lines rather than trusting the CSS `ch` unit.
- **Interaction:** mobile nav opens, closes on Escape, `aria-expanded` tracks
  state; form rejects empty and invalid input, moves focus to the first invalid
  field, clears errors on correction, and recovers from a failed submission.
  No console errors on any page.

---

## 10. Deployment readiness (Phase 4)

The project is ready to push. Nothing has been deployed and **no DNS has been
touched**.

```sh
cd fareedq-site
git remote add origin git@github.com:<you>/fareedq-site.git
git push -u origin main
```

Then Cloudflare Pages → Connect to Git → build command `node build.mjs`,
output directory `dist`. You will get a `*.pages.dev` URL to review before the
domain moves. `public/_redirects` already maps all fourteen legacy Squarespace
URLs with 301s, so the cutover will not break inbound links or search results.

Full instructions, including the domain step, are in `README.md`.
