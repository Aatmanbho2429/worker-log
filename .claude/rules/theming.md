---
paths:
  - "web/src/**/*.scss"
  - "web/src/app/theme.ts"
  - "web/src/index.html"
  - "src-tauri/tauri.conf.json"
---

# Colour and theme

Type, spacing, sizes, BEM and where CSS files live are in
`ui-design-system.md`.

## Medium, not dark

The theme is deliberately **medium-toned**:

- a soft grey page (`$gray-100`) with white cards
- dark grey text (`$gray-800`), not black
- a **medium slate** blue-grey (`$slate-600`) for the sidebar, the auth panel
  and the register header bands

Nothing in the light theme is near-black. The opt-in dark theme is dim
charcoal (`$gray-850` page), not black. Keep new colours in that range: if a
surface needs more weight, step up a slate or grey shade rather than reaching
for black.

## The palette and what each colour means

Raw values live only in the palette section of
`web/src/assets/styles/base/_tokens.scss`. It is the one place a literal colour
is written in SCSS.

- **Blue** (`$blue-*`) — interactive or selected: primary buttons, active
  chips and presets, links, focus. Also grade 1's tone.
- **White** — cards, inputs, the topbar.
- **Grey** (`$gray-*`) — page background, borders, all text shades.
- **Slate** (`$slate-*`) — the medium chrome: sidebar, auth panel, register
  bands, tooltips.
- **Red / amber / green** — danger / warning / success. Red is also the scrap
  grade.
- **Cyan** — grade tone 5 only.

## Partials use semantic tokens

Write `$surface-card`, `$text-muted`, `$accent`, `$danger-text`,
`$sidebar-bg`, `$band` and so on, never `$blue-600`. Raw palette variables are
allowed only in `base/_tokens.scss`, `base/_theme.scss`,
`components/_grade-tone.scss` and the `.barcode-tile` block.

| Family | Tokens | Use |
| --- | --- | --- |
| Surfaces | `surface-page / sunken / card / raised / hover / header` | backgrounds |
| Borders | `border-subtle / default / strong` | card edges, dividers, inputs |
| Text | `text-primary / secondary / muted / faint / accent / on-accent` | copy |
| Accent | `accent`, `accent-hover`, `accent-active`, `accent-soft`, `accent-soft-strong`, `focus-ring` | interactive and selected |
| Status | `danger / warning / success`, each with `-text` and `-soft` | see below |
| Washes | `wash-hover`, `wash-inset`, `wash-on-accent` | translucent, sit over any surface |
| Tables | `table-head-bg`, `table-head-text` | light data-table header |
| Bands | `band`, `band-strong`, `band-text`, `band-text-muted`, `band-divider` | register grid headers |
| Sidebar | `sidebar-bg / border / text / text-muted / hover / active-bg / active-text / indicator` | shell nav, auth brand panel |
| Elevation | `shadow-card`, `shadow-raised` | cards, overlays |

- **Fill vs text.** `$danger` (and `warning`, `success`) is a fill that
  carries white text. On a page or card, write the colour as `$danger-text`,
  and tint a background with `$danger-soft`. The bright -400 shades belong to
  the dark theme only; on white they fail contrast.
- **Need a new token?** Add the CSS variable to **both** `:root` and
  `.app-dark` in `_theme.scss`, then alias it in `_tokens.scss`. A token that
  exists in only one scheme is a bug.
- **No Sass colour functions on aliases.** Each alias holds a `var()`
  reference, so `rgba()`, `darken()` and friends don't work on it. Reach for a
  `-soft` or `wash-*` token, or add one.

## Three things opt out of theming

1. **Barcode tiles** (`.barcode-tile`). Always black bars on a white tile
   (`$black` / `$white`), whatever the theme. Inverted barcodes read poorly on
   cheap laser scanners.
2. **Register header bands** (`$band*`). The month sheet and the scanning grid
   keep medium-slate header bands in both themes, and text on them is always
   `$band-text` / `$band-text-muted`. PrimeNG data tables do *not* use bands;
   they get the light `table-head` header.
3. **Grade colours.** `components/_grade-tone.scss` defines
   `.grade-tone--0…5`: blue, red, amber, green, charcoal, cyan.
   `web/src/app/core/grade-tone.ts` applies them by *position*, returning
   `grade-tone grade-tone--N`.
   - `--grade-accent` is a solid fill carrying white text in both themes.
   - `--grade-bright` (text drawn in the grade colour) and `--grade-soft` have
     separate light and dark values.
   - Tone 0 stays blue and tone 1 stays red: the floor already reads the two
     shipped grades by those colours.

## Two palettes, kept in step

- **The app's tokens:** `_tokens.scss` / `_theme.scss`.
- **PrimeNG's:** `web/src/app/theme.ts` (`WasteLogPreset`,
  `definePreset(Aura, …)`), applied in `app.config.ts` with
  `darkModeSelector: '.app-dark'`. Its `blue`, `gray` and `slate` primitives
  carry the same hex values as the Sass ramps. Change a shade in one and
  change it in the other.
  - Field colours (border, hover, focus, invalid) live in
    `semantic.colorScheme.{light,dark}.formField`; the focus halo is
    `semantic.formField.focusRing.shadow`, one value shared by both schemes.
  - Button colours live in `components.button.colorScheme.{light,dark}` —
    `root.secondary` is the bordered white/`$gray-800` fill the button
    hierarchy in `ui-design-system.md` calls secondary; `root.danger` is the
    solid destructive fill.

A few literal colours legitimately live elsewhere. Update them with the
palette:

- `RAZORPAY_THEME_COLOR` in `web/src/app/views/profile/profile.ts` (=
  `$blue-600`).
- `theme-color` in `web/src/index.html` and the window `backgroundColor` in
  `src-tauri/tauri.conf.json` (both = `--surface-page`). They stop a flash of
  the wrong colour before Angular paints.

## Light ships; dim is maintained

`web/src/index.html` is a plain `<html lang="en">`. Adding `class="app-dark"`
flips both palettes at once. There is no runtime toggle and no per-user
preference, but the dark values must stay correct: every new token gets one.

Printed PDFs (`src-tauri/src/pdf.rs` and its callers) draw with their own
colours and are not part of this theme.
