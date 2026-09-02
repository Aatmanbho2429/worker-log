---
paths:
  - "web/src/**/*.scss"
---

# Colour tokens only

Never hardcode a colour (hex, `rgb()`, a PrimeNG default) in a component
stylesheet. Every colour is a CSS custom property declared once in
`web/src/assets/styles/base/_theme.scss` (`:root` = light theme, `.app-dark` =
dark theme) and aliased to a Sass name in `_tokens.scss`. `@use` `_tokens.scss`
and reach for `$surface-card`, `$ink`, etc. — component styles never write
`var(--...)` inline.

Because each alias holds a `var()` reference, Sass colour functions
(`darken()`, `lighten()`, `rgba()`, …) don't work on them — reach for a
`--wash-*` token or a raw palette variable from `_tokens.scss` instead.

Three things deliberately opt out of theming and should stay that way: barcode
tiles (always dark bars on a white tile — inverted barcodes read poorly on
cheap laser scanners), sheet/table header bands (fixed brand navy), and grade
colours (saturated fills carrying white text in both themes; they do carry a
separate light/dark variant for text drawn *in* the grade colour — see
`_grades.scss`).
