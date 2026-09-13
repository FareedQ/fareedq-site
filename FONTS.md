# FONTS.md — licensing and provenance

## Archivo (headings, labels, navigation, buttons)

- **File:** `public/fonts/archivo-latin-var.woff2` (34 kB, variable weight
  400–700, `latin` subset only, woff2)
- **Designer:** Omnibus-Type
- **Licence:** SIL Open Font License 1.1 — free to use, modify, and redistribute,
  including commercially, provided the licence travels with the files.
- **Source:** Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`),
  self-hosted here so the site makes **no third-party request at runtime**.
- **Why self-hosted:** privacy (no visitor IP sent to Google), performance (one
  preloaded same-origin file), and resilience (no CDN dependency).

The OFL requires that the font not be sold on its own and that any modified
version not use the reserved font name. This file is unmodified.

If you replace it, download the variable woff2 for the `latin` subset and keep
the same path, or update the `@font-face` block in `src/styles.css` and the
`<link rel="preload">` in `build.mjs`.

## Georgia (body text)

Not web-hosted. Georgia ships with macOS and Windows and is used from the
system font stack, with `Iowan Old Style`, `Palatino`, and `Times New Roman`
as fallbacks. It was already the body face on the previous site, so it is
carried over deliberately rather than replaced.

---

## Photography

`public/assets/fareed-jacket-*.webp` — three widths (800 / 1200 / 1800) derived
from the original `Jacket.JPG` on the previous site. The source was 2500×2261
and the file is **you**, so it is reused directly. Converted to WebP for size;
the original is not reproduced here.

**Assets still required from you** — see the review notes in the repository
root. The previous site contains only this one photograph plus three
AI-generated blog thumbnails, which were intentionally not carried over.

---

## Favicon

`favicon.svg` and `apple-touch-icon.png` are generated placeholders: an "F" in
the brand navy. Replace both if you have a real mark, or delete the
`buildFavicon()` function in `build.mjs` and add your own file to `public/`.
