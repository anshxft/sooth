# SOOTH brand kit

| File | Use |
| --- | --- |
| `mark-ink.svg` / `mark-green.svg` | Aperture mark on light / dark backgrounds |
| `favicon.svg` | Browser tab icon (`<link rel="icon" href="/favicon.svg" type="image/svg+xml">`) |
| `apple-touch-icon.png` (180) | iOS home screen |
| `wordmark.svg` / `lockup.svg` | `sooth` in Tektur, outlined; mark + wordmark |
| `x-avatar.png` (400×400) | X profile photo |
| `x-banner.png` (1500×500) | X header (bottom-left kept empty: the avatar covers it) |
| `og.png` (1200×630) | Link preview (`og:image`, `twitter:image`) |

Colors (current site): canvas `#0c0c0b` dark / `#eceae4` light, ink the opposite, muted `#a9a79f` / `#6b6a64`, line `#374151` / `#cbc8bf`, one accent `#ff4f2b` (active states, the lit core, slashes). The first prototype used a mint `#7FFAB7` accent; only the money rain keeps a green.
Fonts (OFL, Google Fonts): Tektur 700 (wordmark, big numbers), Inter Tight 600 (headlines), JetBrains Mono 400 (labels).

Rebuild: `python brand/make_brand.py` (needs `fontTools`) writes the SVGs. PNGs: render the SVGs with `sharp` (`sharp(svg, { density: 144 }).resize(w, h).png()`). The unused logo concepts (`sooth-mark-split.svg`, `sooth-mark-converge.svg`) stay for reference.
