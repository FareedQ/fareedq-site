# Visual audit tooling

Repeatable visual quality assurance for FareedQ.com: screenshot capture tiled to a vision
model's pixel budget, browser measurements as ground truth, a project design-intent file
loaded into every review, classified findings with adjudication, plus regression,
accessibility and performance checks.

The tools live in the global `visual-qa` skill (`~/.dsh/skills/visual-qa/`); everything
project-specific lives here.

```
visual-audit/
  design-intent.md          the site's visual identity, motifs and intent (binding context for reviews)
  audit.config.json         routes, viewports, regions, budgets, tolerance, baseline path
  baselines/                approved regression screenshots + manifest (committed)
  reviews/<date>-<page>/    one run: tiles, measurements, a11y, perf, regression, findings, report
  capture.mjs …             earlier CDP-based capture scripts (M1 and before)
```

## Quick start

```sh
node --run verify                        # the site must build
node tools/csp-preview.mjs 4400          # serve dist/ with the real CSP headers

# 1. capture + measure (writes tiles.json and measurements.json)
node ~/.dsh/skills/visual-qa/scripts/shoot.mjs \
  --config visual-audit/audit.config.json \
  --out visual-audit/reviews/$(date +%F)-homepage --pages home

# 2. design-intent digest, one per review unit
node ~/.dsh/skills/visual-qa/scripts/intent.mjs \
  --file visual-audit/design-intent.md \
  --scope "hero,pillars,pilot,motif,typography,layout,colour,pricing" \
  --max-chars 7000 --out visual-audit/reviews/<dir>/design-intent-desktop.md

# 3. the vision review itself: a workflow with one agent per viewport
#    (template: ~/.dsh/skills/visual-qa/references/workflow-template.md)

# 4. guards
node ~/.dsh/skills/visual-qa/scripts/regress.mjs --mode compare \
  --config visual-audit/audit.config.json --out visual-audit/reviews/<dir>/regression
node ~/.dsh/skills/visual-qa/scripts/axe.mjs  --config visual-audit/audit.config.json --out <dir>/a11y.json
node ~/.dsh/skills/visual-qa/scripts/perf.mjs --config visual-audit/audit.config.json --out <dir>/perf.json
```

## Design intent

`design-intent.md` tells an auditor which elements are deliberate — the three-pillar
growing-rule motif, the Archivo/Georgia pairing, the restrained palette, the photo-first
mobile hero, the plain-text price rows — **and explicitly says that deliberate choices are
still criticisable**. It is context, not an immune system.

`intent.mjs` always includes the auditor protocol, purpose and identity, ranks the rest of
the sections against the review scope (a scope word in a section title outweighs a body
mention), and lists every dropped section with its score. Budget per unit: 7–8k characters
(≈2k tokens). When the site's intent changes, edit the file — nothing else needs to change.

## Capture and the image budget

The vision route accepts **640 000 px per image**; anything larger is silently downscaled into
noise. `shoot.mjs` computes tile height from that budget and an aspect cap, so a 1440px page
yields 1440×444 tiles (622 k px) and a 390px page yields 390×624 (243 k px). Whole-page
"overview" images are produced only while the page is under a 6:1 aspect ratio — a mobile
page 21:1 tall would be ~170 px wide and useless, so it is skipped and its detail tiles carry
the review.

Capture conditions (identical across compared runs): Playwright Chromium, device scale
factor 1, light colour scheme, `prefers-reduced-motion: reduce`, fonts/images/scroll settled,
animations disabled.

## The review, end to end

1. **Measure first** — `measurements.json`: computed type, contrast pairs, rendered measure,
   geometry, overflow, console errors. Written before any model sees a pixel.
2. **Read the intent** — the agent must read the digest before forming an opinion.
3. **Classify** — every finding is exactly one of `implementation_defect`,
   `intentional_but_ineffective`, `creative_opportunity`, `intentional_and_effective`, with
   `observation` separated from `interpretation` and a `designIntentRef`.
4. **Adjudicate** — each finding is checked against measurements. Rejected claims and
   corrected numbers are kept in `findings.json` so the review is auditable. Totals must
   reconcile: `raw → deduplicated → accepted (actionable + observations) → rejected`.
5. **Approve** — nothing is fixed on a reviewer's word:
   - **safe technical correction** (measured defect, e.g. an off-baseline numeral) — may be fixed.
   - **design refinement** (composition, hierarchy, aesthetics) — needs Fareed's approval.
   - **conceptual change** (the philosophy or how it is represented) — needs the owner.

## Regression baselines

Baselines are evidence, so they are never written implicitly:

```sh
# compare — never writes baselines; exits 1 when a capture drifts past tolerance
node tools/visual-qa … regress.mjs --mode compare --config visual-audit/audit.config.json --out <dir>/regression

# re-approve after reviewing the diff — always records who/why
node … regress.mjs --mode seed --reason "why these pixels are now the reference" --approve-replace
```

The comparator reports changed pixels, the ratio against `regression.tolerance.pixelRatio`
(default 0.2 %), a diff image with changed pixels in magenta, and bounding boxes of the
changed regions (grouped on a 32 px cell grid). Current set: homepage, coaching and about at
desktop and mobile — six baselines, all within tolerance as of the M2 seed.

A pixel difference is a **change**, not a defect: intentional improvement, regression, or
environment noise is a human call.

## Accessibility

Automated (laboratory): axe-core over 18 route/viewport pairs at `wcag2a/2aa/21aa/22aa`,
keyboard traversal (31 stops on the form), focus-indication detection (outline vs
box-shadow vs none), effective target size measured through the associated label,
reduced-motion check.

**Cannot be automated, needs a human:** screen-reader announcement order and semantics,
focus *logic*, contrast over images, whether error messages are comprehensible, whether the
reduced-motion experience still carries the information. Passing automation is not WCAG
conformance.

Known result worth watching: the form's five controls indicate focus with a box-shadow at
14 % alpha (`rgba(37,53,81,.14)`) plus, on text fields, a navy border. The script reports
these as `weakShadow` — verify by eye.

**Trusting a zero:** a clean axe run is only meaningful if axe is actually running. It is
injected with `page.evaluate(axeSource)`, which goes through the DevTools protocol and so is
not blocked by `script-src 'self'`. To re-confirm it is live, inject a deliberate fault
(`<img>` without alt, `<button>` without a name) and check that `image-alt` and
`button-name` appear — that self-test passed on this site, so the 0-violation result is a
real clean run rather than a silently skipped tool.

## Performance

Laboratory numbers from one local run (`perf.json`), checked against `performance.budgets`:

| Budget | Value | Current |
| --- | --- | --- |
| JS (gzip) | 15 KB | 2.2 KB |
| CSS (gzip) | 20 KB | 11.5 KB |
| CLS | 0.02 | 0 |
| LCP | 1500 ms | 92–132 ms |
| Transfer | 600 KB | 91–168 KB |
| Long tasks | 0 | 0 |

These compare runs; they are not real-user metrics.

## Configuration

`audit.config.json` — `baseUrl`, `pixelBudget`, `maxTileAspect`, `viewports`, `pages` (with
`regions` for detail tiles), `measurements.selectors`, `designIntent`, `a11y.tags`,
`performance.budgets`, `regression` (pages, viewports, masks, tolerance, baselines path).

## Known limitations

- A vision model cannot read CSS: it has twice proposed `text-wrap: balance`, which the site
  already uses. Always re-measure before accepting a suggested fix.
- It misreads deliberate motifs as broken components unless the intent digest is supplied
  (M1), and drifts on coordinates by a few px (M2).
- Severity is a proposal, not a measurement; the same element scored `nit` in one run and
  `intentional_and_effective` in the next.
- Reviews are scoped by region; a page is not fully covered unless every section is captured.
