# Original photographs

Not published. `build.mjs` copies `public/` into `dist/`, and this folder is not
in `public/`, so nothing here ships.

- `Headshot.png` — 1254 × 1254 PNG. The professional portrait.
- `Outdoors.jpeg` — 3382 × 5072 JPEG (2:3 portrait). The outdoor photograph.

The site serves WebP derivatives (480/800/1200 px wide, plus a 1200 × 1200 JPEG
social card) from `public/assets/`. They are generated from these files:

```sh
node tools/images.mjs
```

Keep the originals here rather than resizing them: they are the only copy at
full resolution, and every derivative can be rebuilt from them.
