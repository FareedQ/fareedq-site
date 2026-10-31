# Phase 1 — before and after

Screenshots of FareedQ.com taken immediately before and immediately after the
Phase 1 visual refinements, under identical conditions, so the two can be
compared directly.

- **Before:** `before-phase1/` — captured from the build that the independent
  visual audit reviewed.
- **After:** `after-phase1/` — captured from the build after the Phase 1 changes.
- **Comparisons:** `contact-sheets/compare-*.png` — before/after pairs, one sheet
  per page and viewport. Each sheet shows the first screen at a readable size and
  the page below it, scaled.
- **Full-resolution originals:** `before-phase1/full-pages/…` and
  `after-phase1/full-pages/…` (full pages) plus `sections/…` (viewport captures).

## Identical capture conditions

Both runs used `visual-audit/capture.mjs` against the local CSP-enabled preview
(`node tools/csp-preview.mjs 4400`), with:

| Setting | Value |
| --- | --- |
| Browser | Google Chrome (headless, DevTools Protocol) |
| Viewports | 1440×900 (desktop), 390×844 (mobile) |
| Device scale factor | 1 |
| Colour scheme | light |
| Motion | `prefers-reduced-motion: reduce` (emulated; no styles injected) |
| Waiting | document complete → `fonts.ready` → images decoded → full scroll pass → two frames |
| Full-page capture | `captureBeyondViewport` clipped to the CSS content size |

No page in the site emits a `style` attribute, and no styles were injected for
these captures.

## What changed between the two runs

| Page | Before height | After height |
| --- | --- | --- |
| Homepage (desktop / mobile) | 7084 / 8737 px | 6876 / 8534 px |
| About (desktop / mobile) | 6185 / 8119 px | 6468 / 8299 px |
| Coaching (desktop / mobile) | 10801 / 13629 px | 11219 / 13736 px |
| Pilot (desktop / mobile) | 8529 / 11669 px | 8599 / 11913 px |
| Onboarding (desktop / mobile) | 3161 / 5047 px | 3233 / 5047 px |

The composition changes themselves — background tones, the About hero, the
homepage mobile hero, the FAQ, and the split-section variation — are described in
the Phase 1 report. These images are the evidence; the descriptions are not a
substitute for looking at them.

## Reading the comparison sheets

`compare-home-desktop.png`, `compare-home-mobile.png`, `compare-about-desktop.png`,
`compare-about-mobile.png`, `compare-coaching-desktop.png`,
`compare-coaching-mobile.png`, `compare-pilot-desktop.png`.

Mobile sheets crop the page row to the first 3,000px so the pairs stay legible at
a readable width; the uncropped full pages are in `full-pages/mobile/`. Images are
scaled proportionally throughout — nothing is stretched.

## Reproducing

```sh
cd ~/Code/fareedq-site
node --run verify
node tools/csp-preview.mjs 4400

# capture the current build into a labelled run
AUDIT_OUT=after-phase1 AUDIT_PAGES=home,about,coaching,pilot,onboarding \
  AUDIT_DEVICES=desktop,mobile node visual-audit/capture.mjs

node visual-audit/validate.mjs after-phase1/manifest.json   # read every PNG back
node visual-audit/compare-phase1.mjs                        # rebuild the sheets
```

`before-phase1/` was produced the same way, pointed at the pre-change build.
