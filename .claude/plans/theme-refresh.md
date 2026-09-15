# Plan: theme refresh — blue / white / grey, medium tone, BEM

Written 2026-09-15 for an implementer picking this up cold. Delete this file
when it ships (Phase 9).

## Goal

1. **A medium-toned theme that reads well on a shop-floor monitor.**
   - **Blue** means interactive or selected.
   - **White** cards sit on a **soft grey** page.
   - The sidebar and the register header bands are a **medium slate**
     blue-grey, not black.
   - Text is dark grey, not black.
   - Red, amber and green only for status and grade identity.
2. **Type.** One family, Inter Variable, with real 400/500/600 weights,
   self-hosted. Oswald goes. One scale each for size, spacing, radius, control
   height and icons.
3. **Less clutter.** No all-caps headings, no wide letter-spacing, no
   gradients or glows, fewer accent bars.
4. **Strict BEM, and no CSS in Angular component files.**
   - Every component loses its `styleUrl`, and its `.scss` file is deleted.
   - All custom CSS lives in partials under `web/src/assets/styles/`, one BEM
     block per shared partial and one partial per screen.
   - Nothing styles a tag, an id, or another block's internals.

**The spec is the rules**, written alongside this plan:
- `.claude/rules/theming.md` — colour
- `.claude/rules/ui-design-system.md` — type, spacing, sizes, BEM, file
  layout, screen anatomy
- `.claude/rules/angular-ui.md` — no component stylesheets

If this plan and a rule disagree, the rule wins; fix the plan.

## Non-goals

- PDF exports (`src-tauri/src/pdf.rs` and its callers) keep their colours.
- Barcode symbology and tile geometry; tiles stay black on white.
- New screens, behaviour changes, or a runtime dark-mode toggle.
- Copy rewrites, except where removing CSS `uppercase` exposes bad casing.

## What is wrong today (the why)

- **Fake bold.** `web/src/assets/fonts/fonts.css` maps Inter/Oswald
  500/600/700 onto the *400* files.
- **Shouty type.** Oswald in uppercase with 0.06–0.18em tracking on ~45 rules.
- **Too dark.** The navy header bands and navy auth panel. The window also
  starts dark: `tauri.conf.json` has `theme: "Dark"` and
  `backgroundColor: "#05090f"`, and `index.html` has `theme-color #05090f`, so
  the window flashes dark before the light app paints.
- **Unreadable status text on light.** These use -400 shades tuned for dark,
  all under 3:1 on white:
  - `.field__error` (red)
  - `.scan__state--problem`, `.scanbox__result--problem`, `.settings__warning`
    (amber)
  - `.scan__state--ok`, `.scan__recent-row:first-child`,
    `.scanbox__result--ok` (green)
- **Gradients** on KPI tiles, the scan status panel, the logo mark, avatars and
  the auth panel.
- **Literal sizes.** Spacing and font sizes like `0.7rem 1.4rem`,
  `0.5rem 0.7rem`, `1.8rem` and `2.2rem` bypass the scale.
- **Component stylesheets.** 15 components carry a `styleUrl`, and two use
  `:host ::ng-deep` (`sheet.scss`, `range-filter.scss`).
- **Non-BEM selectors.**
  - Tag selectors: `.empty i`, `.auth__point span/p`, `.profile__facts dt/dd`,
    `.settings__facts dt`, `.grid th, td`, `.sheet thead th`, `tbody tr`,
    `tfoot td`.
  - Structural hacks: `:first-child` / `:has()` doing a modifier's job.
  - Utility classes: `.numeric`, `.tabular`.
  - A block-less modifier: `.col--sr`.
  - Specificity fights with `!important` (`sheet.scss`).
  - Grade tone classes that aren't BEM: `g-tone-N`.
- **Names that collide once global.**
  - `.skeletons` (6 files), `.card__hint` (2, different rules), `.numeric` (2).
  - `register.scss` restyles `.auth__card`, which would leak into login.
  - Generic names that clash easily: `.grid`, `.grade`, `.top`, `.split`,
    `.filter`, `.reasons`.
- **Duplication.** `.stat` (reports) and `.tally__item` (waste) are the same
  component.
- **Inline widths in templates.** `style="width: 10rem"` on `<th>` in
  workers/series/grades; dialog widths are hardcoded literals.
- **Footer text colour.** `sheet.scss` puts `tfoot td` on the band but never
  sets a text colour.

---

## Phase 0 — setup

1. From the repo root: `git checkout -b theme-refresh`.
2. `npm run web:build`. Note any warnings as the baseline.
3. In `web/`: `npm install @fontsource-variable/inter`. It is OFL-licensed;
   Angular bundles the woff2, so it satisfies the CSP's `font-src 'self'`.

## Phase 1 — tokens: `web/src/assets/styles/base/_tokens.scss`

Replace the whole file with the content below. **Keep the TEMPORARY alias block
at the bottom** so unmigrated sheets still compile. Phase 9 deletes it.

```scss
// ============================================================== the palette ==
//
// Raw paint, and the only place a literal colour is written. These do not
// change with the theme — `_theme.scss` picks from them. Partials use the
// semantic aliases further down, never these (.claude/rules/theming.md).

$white: #ffffff;
$black: #000000;

// Blue: interactive and selected. Same values as `blue` in `app/theme.ts`.
$blue-50: #eff6ff;
$blue-100: #dbeafe;
$blue-200: #bfdbfe;
$blue-300: #93c5fd;
$blue-400: #60a5fa;
$blue-500: #3b82f6;
$blue-600: #2563eb;
$blue-700: #1d4ed8;
$blue-800: #1e40af;
$blue-900: #1e3a8a;
$blue-950: #172554;

// Neutral greys, white to charcoal: surfaces, borders, text. Same values as
// `gray` in `app/theme.ts`. 750/850 exist for the dim (dark) theme.
$gray-0: #ffffff;
$gray-50: #f7f8fa;
$gray-100: #f0f2f5;
$gray-200: #e3e6eb;
$gray-300: #d0d5dd;
$gray-400: #a3abb6;
$gray-500: #7c8491;
$gray-600: #58616d;
$gray-700: #3f4753;
$gray-750: #2f3540;
$gray-800: #262c35;
$gray-850: #1d222a;
$gray-900: #161a21;

// Slate: the medium blue-grey chrome — sidebar, auth panel, register bands.
// Same values as `slate` in `app/theme.ts`.
$slate-200: #e2e8f0;
$slate-300: #cbd5e1;
$slate-400: #94a3b8;
$slate-500: #64748b;
$slate-550: #55657a;
$slate-600: #475569;
$slate-700: #334155;

// Status and grade identity. Reached only through the semantic tokens below
// or `components/_grade-tone.scss`.
$red-400: #f87171;
$red-500: #ef4444;
$red-600: #dc2626;
$red-700: #b91c1c;
$red-800: #991b1b;

$amber-400: #fbbf24;
$amber-500: #f59e0b;
$amber-600: #d97706;
$amber-700: #b45309;
$amber-800: #92400e;
$amber-900: #78350f;

$green-400: #4ade80;
$green-500: #22c55e;
$green-600: #16a34a;
$green-700: #15803d;
$green-800: #166534;
$green-900: #14532d;

$cyan-400: #22d3ee;
$cyan-500: #06b6d4;
$cyan-600: #0891b2;
$cyan-700: #0e7490;
$cyan-800: #155e75;
$cyan-900: #164e63;

// ================================================================ the theme ==
//
// The values live in `_theme.scss`, which emits the `:root` / `.app-dark`
// blocks and is pulled in once by `main.scss`. This file must stay free of CSS
// rules: every partial `@use`s it, and anything emitted here would be stamped
// out again in each of them. (Mixins are fine — they emit nothing until
// included.)
//
// These hold a `var()` reference rather than a colour, so Sass colour functions
// cannot be applied to them — reach for a `-soft` or `wash-*` token instead.

$surface-page: var(--surface-page);
$surface-sunken: var(--surface-sunken);
$surface-card: var(--surface-card);
$surface-raised: var(--surface-raised);
$surface-hover: var(--surface-hover);
$surface-header: var(--surface-header);

$border-subtle: var(--border-subtle);
$border-default: var(--border-default);
$border-strong: var(--border-strong);

$text-primary: var(--text-primary);
$text-secondary: var(--text-secondary);
$text-muted: var(--text-muted);
$text-faint: var(--text-faint);
$text-accent: var(--text-accent);
$text-on-accent: var(--text-on-accent);

$accent: var(--accent);
$accent-hover: var(--accent-hover);
$accent-active: var(--accent-active);
$accent-soft: var(--accent-soft);
$accent-soft-strong: var(--accent-soft-strong);
$focus-ring: var(--focus-ring);

// `$danger` etc. are fills that carry white text; `-text` is the same meaning
// written on a page or card; `-soft` is a tinted background.
$danger: var(--danger);
$danger-text: var(--danger-text);
$danger-soft: var(--danger-soft);
$warning: var(--warning);
$warning-text: var(--warning-text);
$warning-soft: var(--warning-soft);
$success: var(--success);
$success-text: var(--success-text);
$success-soft: var(--success-soft);

$shadow-card: var(--shadow-card);
$shadow-raised: var(--shadow-raised);

$wash-hover: var(--wash-hover);
$wash-inset: var(--wash-inset);
$wash-on-accent: var(--wash-on-accent);

$table-head-bg: var(--table-head-bg);
$table-head-text: var(--table-head-text);

$band: var(--band);
$band-strong: var(--band-strong);
$band-text: var(--band-text);
$band-text-muted: var(--band-text-muted);
$band-divider: var(--band-divider);

$sidebar-bg: var(--sidebar-bg);
$sidebar-border: var(--sidebar-border);
$sidebar-text: var(--sidebar-text);
$sidebar-text-muted: var(--sidebar-text-muted);
$sidebar-hover: var(--sidebar-hover);
$sidebar-active-bg: var(--sidebar-active-bg);
$sidebar-active-text: var(--sidebar-active-text);
$sidebar-indicator: var(--sidebar-indicator);

// ================================================================== the rest ==
//
// Type, spacing and geometry, which do not change with the theme.
// 1rem == 10px (see `_reset.scss`), so every value reads in whole pixels.

$font-body: 'Inter Variable', 'Inter', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif;
// Machine strings only: barcode digits, device ids, references, file paths.
$font-mono: 'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', ui-monospace, monospace;

$fs-xs: 1.2rem; // overline labels, tiny captions
$fs-sm: 1.3rem; // secondary text, meta, hints, labels, dense grids
$fs-base: 1.5rem; // body, table cells, inputs, buttons, nav
$fs-md: 1.7rem; // card titles, names on the waste screen
$fs-lg: 2rem; // dialog titles, counts on grade counters
$fs-xl: 2.4rem; // page titles
$fs-2xl: 3.2rem; // KPI values

$fw-regular: 400;
$fw-medium: 500;
$fw-semibold: 600;

$lh-tight: 1.2;
$lh-snug: 1.35;
$lh-body: 1.5;

$ls-tight: -0.01em;
$ls-overline: 0.06em;

// 4px grid.
$space-2xs: 0.2rem;
$space-xs: 0.4rem;
$space-sm: 0.8rem;
$space-md: 1.2rem;
$space-lg: 1.6rem;
$space-xl: 2.4rem;
$space-2xl: 3.2rem;
$space-3xl: 4.8rem;

$radius-sm: 0.4rem;
$radius-md: 0.6rem;
$radius-lg: 0.8rem;
$radius-xl: 1.2rem;
$radius-pill: 9999px;

$control-h-sm: 3.2rem;
$control-h: 4rem;
// Anything tapped on the floor, possibly with a glove.
$control-h-lg: 4.8rem;

$icon-sm: 1.4rem;
$icon-md: 1.6rem;
$icon-lg: 2rem;
$icon-xl: 2.4rem;
$icon-hero: 3.2rem;

$duration-fast: 120ms;
$duration-base: 180ms;
$ease-standard: cubic-bezier(0.2, 0, 0, 1);

$shell-sidebar-width: 24rem;
$shell-topbar-height: 5.6rem;

// ================================================================== mixins ==

// The only sanctioned uppercase: a small label sitting above a value.
@mixin overline {
  font-size: $fs-xs;
  font-weight: $fw-semibold;
  letter-spacing: $ls-overline;
  line-height: $lh-snug;
  text-transform: uppercase;
}

// Digits that sit in columns or tick over must not shift width.
@mixin numeric {
  font-variant-numeric: tabular-nums;
}

// Focus halo for hand-rolled inputs; buttons use the global :focus-visible.
@mixin focus-ring {
  box-shadow: 0 0 0 0.3rem $focus-ring;
  outline: none;
}

@mixin truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// ------------------------------------------------- TEMPORARY (theme-refresh) --
// Old names, kept only so unmigrated sheets compile. Phase 9 deletes this block.
$navy-50: $blue-50;
$navy-100: $blue-100;
$navy-200: $blue-200;
$navy-300: $blue-300;
$navy-400: $blue-500;
$navy-500: $blue-600;
$navy-600: $blue-700;
$navy-700: $slate-700;
$navy-800: $slate-600;
$navy-900: $slate-700;
$navy-950: $slate-700;
$ink-0: $gray-0;
$ink-50: $gray-50;
$ink-100: $gray-100;
$ink-200: $gray-200;
$ink-300: $gray-300;
$ink-400: $gray-400;
$ink-450: $gray-500;
$ink-500: $gray-600;
$ink-600: $gray-600;
$ink-700: $gray-700;
$ink-800: $gray-800;
$ink-900: $gray-800;
$red-300: $red-400;
$violet-400: $gray-400;
$violet-500: $gray-700;
$violet-600: $gray-700;
$violet-700: $gray-800;
$teal-400: $cyan-400;
$teal-500: $cyan-700;
$teal-600: $cyan-800;
$teal-700: $cyan-900;
$font-display: $font-body;
```

## Phase 2 — theme values: `web/src/assets/styles/base/_theme.scss`

Keep the header comment, updating the navy wording. Replace both blocks:

```scss
:root {
  // Soft grey page, white cards: medium overall, never stark.
  --surface-page: #{$gray-100};
  --surface-sunken: #{$gray-200};
  --surface-card: #{$gray-0};
  --surface-raised: #{$gray-0};
  --surface-hover: #{$gray-100};
  --surface-header: #{$gray-0};

  --border-subtle: #{$gray-200};
  --border-default: #{$gray-300};
  --border-strong: #{$gray-400};

  // Dark grey rather than black: full contrast without the harshness.
  --text-primary: #{$gray-800};
  --text-secondary: #{$gray-700};
  --text-muted: #{$gray-600};
  --text-faint: #{$gray-500};
  --text-accent: #{$blue-700};
  --text-on-accent: #{$white};

  // Same solid blue fill in both schemes, so the primary action looks like
  // itself whichever theme is on.
  --accent: #{$blue-600};
  --accent-hover: #{$blue-700};
  --accent-active: #{$blue-800};
  --accent-soft: #{rgba($blue-600, 0.08)};
  --accent-soft-strong: #{rgba($blue-600, 0.14)};
  --focus-ring: #{rgba($blue-500, 0.4)};

  --danger: #{$red-600};
  --danger-text: #{$red-700};
  --danger-soft: #{rgba($red-600, 0.08)};
  --warning: #{$amber-600};
  --warning-text: #{$amber-700};
  --warning-soft: #{rgba($amber-500, 0.12)};
  --success: #{$green-600};
  --success-text: #{$green-700};
  --success-soft: #{rgba($green-600, 0.1)};

  --shadow-card: 0 0.1rem 0.2rem #{rgba($gray-800, 0.06)};
  --shadow-raised: 0 1.2rem 3.2rem -0.4rem #{rgba($gray-800, 0.18)};

  --wash-hover: #{rgba($gray-800, 0.035)};
  --wash-inset: #{rgba($gray-800, 0.05)};
  --wash-on-accent: #{rgba($black, 0.2)};

  --table-head-bg: #{$gray-50};
  --table-head-text: #{$gray-600};

  // Register header bands: medium slate in both themes, always light text.
  --band: #{$slate-550};
  --band-strong: #{$slate-600};
  --band-text: #{$white};
  --band-text-muted: #{$slate-200};
  --band-divider: #{rgba($white, 0.2)};

  // Sidebar and auth panel: the same medium slate.
  --sidebar-bg: #{$slate-600};
  --sidebar-border: #{rgba($white, 0.12)};
  --sidebar-text: #{$slate-200};
  --sidebar-text-muted: #{$slate-300};
  --sidebar-hover: #{rgba($white, 0.08)};
  --sidebar-active-bg: #{rgba($white, 0.16)};
  --sidebar-active-text: #{$white};
  --sidebar-indicator: #{$blue-300};
}

// Dim rather than black: charcoal surfaces, never near-black.
.app-dark {
  --surface-page: #{$gray-850};
  --surface-sunken: #{$gray-900};
  --surface-card: #{$gray-800};
  --surface-raised: #{$gray-750};
  --surface-hover: #{$gray-750};
  --surface-header: #{$gray-800};

  --border-subtle: #{$gray-750};
  --border-default: #{$gray-700};
  --border-strong: #{$gray-600};

  --text-primary: #{$gray-50};
  --text-secondary: #{$gray-300};
  --text-muted: #{$gray-400};
  --text-faint: #{$gray-500};
  --text-accent: #{$blue-400};
  --text-on-accent: #{$white};

  --accent: #{$blue-600};
  --accent-hover: #{$blue-700};
  --accent-active: #{$blue-800};
  --accent-soft: #{rgba($blue-400, 0.12)};
  --accent-soft-strong: #{rgba($blue-400, 0.2)};
  --focus-ring: #{rgba($blue-400, 0.5)};

  --danger: #{$red-600};
  --danger-text: #{$red-400};
  --danger-soft: #{rgba($red-400, 0.14)};
  --warning: #{$amber-600};
  --warning-text: #{$amber-400};
  --warning-soft: #{rgba($amber-400, 0.14)};
  --success: #{$green-600};
  --success-text: #{$green-400};
  --success-soft: #{rgba($green-400, 0.12)};

  --shadow-card: 0 0.1rem 0.2rem #{rgba($black, 0.3)};
  --shadow-raised: 0 1.6rem 4rem #{rgba($black, 0.45)};

  --wash-hover: #{rgba($white, 0.04)};
  --wash-inset: #{rgba($black, 0.2)};
  --wash-on-accent: #{rgba($black, 0.2)};

  --table-head-bg: #{$gray-750};
  --table-head-text: #{$gray-400};

  --band: #{$slate-600};
  --band-strong: #{$slate-700};
  --band-text: #{$white};
  --band-text-muted: #{$slate-200};
  --band-divider: #{rgba($white, 0.2)};

  --sidebar-bg: #{$slate-700};
  --sidebar-border: #{rgba($white, 0.1)};
  --sidebar-text: #{$slate-200};
  --sidebar-text-muted: #{$slate-300};
  --sidebar-hover: #{rgba($white, 0.06)};
  --sidebar-active-bg: #{rgba($white, 0.14)};
  --sidebar-active-text: #{$white};
  --sidebar-indicator: #{$blue-300};
}
```

## Phase 3 — stylesheet architecture

This phase creates the structure the rest of the plan fills in.

1. **Target layout.** It is also documented in `ui-design-system.md`.

   ```
   web/src/assets/styles/
   ├── main.scss        the only entry; @use order: base → components → shared → views
   ├── base/            _tokens.scss (no CSS output) · _theme.scss · _reset.scss
   ├── components/      one partial per shared BEM block, file name = block name
   ├── shared/          one partial per shared Angular component (_scan-field, _range-filter)
   └── views/           one partial per screen, holding only that screen's blocks
   ```

   Partials `@use 'base/tokens' as *;` exactly as today's global partials do.

2. **`web/angular.json`.** Change `schematics["@schematics/angular:component"]`
   from `"style": "scss"` to `"style": "none"`, so `ng generate component`
   never creates a stylesheet again.
3. **App host element.** `app.scss` only sets `:host`.
   - In `web/src/app/app.ts`, replace `styleUrl` with
     `host: { class: 'app' }`.
   - Create `components/_app.scss` with
     `.app { display: block; height: 100%; }`.
   - Delete `app.scss`.
4. **Grade tones become BEM.**
   - Rename `components/_grades.scss` → `components/_grade-tone.scss`.
   - Selectors change from `.g-tone-N` to `.grade-tone--N`; the dark variants
     become `.app-dark .grade-tone--N`.
   - In `web/src/app/core/grade-tone.ts`, return
     `` `grade-tone grade-tone--${n}` ``.
   - Templates bind it with `[class]="gradeToneClass(i)"` next to static
     classes (`waste.html`, `reports.html`, `grades.html`, plus the tone
     strings built in `barcodes.ts`). Angular merges static and bound classes,
     so no template change is needed for this.
   - `.grade-tone` itself has no rules; it only marks the block.
5. **`components/_primeng.scss`.** Create it for the unavoidable PrimeNG
   internals.
   - Every rule here is scoped under an app BEM class handed to the component
     through `styleClass` / `class`.
   - This is the only partial that may name `.p-*` classes or use
     `!important`, and each rule gets a one-line comment saying why.
   - App-wide PrimeNG looks belong in `theme.ts`, not here.

**Checkpoint:** `npm run web:build` passes at the end of this phase and every
phase after.

## Phase 4 — base, fonts, host chrome

1. **`base/_reset.scss`**
   - `html { font-size: 62.5%; }` stays. PrimeNG's rem tokens depend on it.
   - `body`: `font-family: $font-body; font-size: $fs-base; font-weight: $fw-regular; line-height: $lh-body; color: $text-primary; background-color: $surface-page; font-feature-settings: 'cv05', 'cv08';`
     keep antialiasing.
     - `cv05` is the lowercase l with a tail; `cv08` is the capital I with
       serifs. Together they separate I/l/1 in names.
     - Check both glyphs render; drop the line if this Inter build lacks them.
   - `h1–h4`: `font-weight: $fw-semibold; line-height: $lh-tight; letter-spacing: $ls-tight;`.
   - **Delete `.tabular`.** Utility classes are gone; the one user
     (`shell__clock`) includes `numeric` itself.
   - Add `:focus-visible { outline: 0.2rem solid $accent; outline-offset: 0.2rem; }`.
   - Scrollbar: track `transparent`; thumb `$border-default` with
     `border: 0.2rem solid transparent; background-clip: padding-box;`; hover
     `$border-strong`.
   - `_reset.scss` is the only partial allowed element selectors (`html`,
     `body`, `h1–h4`, `*`, scrollbar pseudo-elements).
2. **Fonts**
   - Delete `web/src/assets/fonts/` entirely: `fonts.css` plus the four woff2.
   - `web/src/styles.scss` becomes:
     `@use 'primeicons/primeicons.css'; @use '@fontsource-variable/inter/index.css'; @use './assets/styles/main.scss';`
   - If Sass will not resolve the package path, add
     `node_modules/@fontsource-variable/inter/index.css` to `styles` in
     `angular.json` instead.
   - Confirm in DevTools → Network that `inter-latin-wght-normal*.woff2`
     loads from the app origin.
3. **`web/src/index.html`:** `theme-color` → `#f0f2f5`.
4. **`src-tauri/tauri.conf.json`** window: `"theme": "Light"`,
   `"backgroundColor": "#f0f2f5"`.
5. **`web/src/app/views/profile/profile.ts`:**
   `RAZORPAY_THEME_COLOR = '#2563eb'`.

## Phase 5 — PrimeNG preset: `web/src/app/theme.ts`

Rewrite the comments: navy → blue/slate, ink → gray.

**Do not guess token paths.** For each component, open its design-token type
under `node_modules/@primeuix/themes` (search e.g. `DataTableDesignTokens`).
Use the real key names, and leave out anything that does not exist.

- **`primitive`**
  - `blue` (11 values), `gray` (13 values, keys `0`…`900` incl. `750`/`850`)
    and `slate` (the 7 values) from Phase 1.
  - This deliberately overrides Aura's own `blue`/`gray`/`slate`: one set of
    each in the app. Leave `red`/`amber`/`green`/`cyan` alone.
- **`semantic`**
  - `primary` → `{blue.50}`…`{blue.950}`.
  - `focusRing`: `{ width: '2px', style: 'solid', color: '{blue.500}', offset: '2px' }`.
  - `formField`: `paddingX '1.2rem'`, `paddingY '0.8rem'`,
    `borderRadius '6px'`, `sm { fontSize '1.3rem', paddingX '1rem', paddingY '0.6rem' }`,
    `lg { fontSize '1.6rem', paddingX '1.4rem', paddingY '1.1rem' }`.
    Target heights are 4.0rem default and 4.8rem large; check in DevTools.
  - `colorScheme.light`
    - `primary { color '{blue.600}', contrastColor '#ffffff', hoverColor '{blue.700}', activeColor '{blue.800}' }`
    - `highlight { background 'rgba(37, 99, 235, 0.08)', focusBackground 'rgba(37, 99, 235, 0.14)', color '{blue.800}', focusColor '{blue.900}' }`
    - `surface` 0…950 mapped `0→gray.0`, `50→gray.50`, … `800→gray.800`,
      `900→gray.850`, `950→gray.900`. Aura has no 750/850 keys, so shift the
      last two.
  - `colorScheme.dark`
    - `primary { color '{blue.400}', contrastColor '{gray.900}', hoverColor '{blue.300}', activeColor '{blue.200}' }`
    - `highlight { background 'rgba(96, 165, 250, 0.14)', focusBackground 'rgba(96, 165, 250, 0.22)', color '#ffffff', focusColor '#ffffff' }`
    - `surface` mapped the same way. Keep the comment about the ramp order: an
      inverted ramp turns dialogs white.
- **`components.button`**
  - root: `borderRadius '6px'`, `paddingX '1.6rem'`, `paddingY '0.8rem'`,
    `gap '0.8rem'`, `label.fontWeight '600'`.
  - `sm { fontSize '1.3rem', paddingX '1.2rem', paddingY '0.6rem' }`,
    `lg { fontSize '1.6rem', paddingX '2rem', paddingY '1.1rem' }`.
  - Primary in both schemes: `{blue.600}` / hover `{blue.700}` / active
    `{blue.800}`, matching borders, white text, focus ring `{blue.500}`.
  - `text.secondary`
    - light: color `{gray.600}`, hover `{gray.100}`, active `{gray.200}`
    - dark: color `{gray.300}`, hover `{gray.750}`, active `{gray.700}`
  - `text.danger`
    - light: color `{red.600}`, hover `rgba(220, 38, 38, 0.08)`
    - dark: color `{red.400}`, hover `rgba(248, 113, 113, 0.14)`
- **`components.datatable`** — intent: a light header, not a band.
  - light: header cell background `{gray.50}`, color `{gray.600}`, border
    `{gray.200}`; column title weight 600; header cell padding
    `'1rem 1.6rem'`; body cell padding `'1.2rem 1.6rem'`, border
    `{gray.200}`; row hover `{gray.50}`; footer background `{gray.50}`.
  - dark: header `{gray.750}` / `{gray.400}` / border `{gray.700}`; body
    border `{gray.750}`; row `{gray.800}`, hover `{gray.750}`.
- **`components.dialog`:** `borderRadius '12px'`; header padding
  `'2rem 2.4rem 1.2rem'`; title `'1.8rem'` / `'600'`; content padding
  `'0 2.4rem 2rem'`; footer padding `'0 2.4rem 2rem'`, gap `'0.8rem'`.
- **`components.toast`:** `borderWidth '0 0 0 4px'`, `borderRadius '8px'`.
- **`components.tooltip`:** background `{slate.700}`, color `#ffffff`, padding
  `'0.6rem 1rem'`, `borderRadius '6px'`.
- **`components.tag`:** `fontSize '1.2rem'`, `fontWeight '600'`, padding
  `'0.2rem 0.8rem'`, `borderRadius '4px'`.
- **`components.tabs`:** active bar `{blue.600}`; tab padding
  `'1.2rem 1.6rem'`, weight 500.
- **`components.skeleton`** light: background `{gray.200}`.

## Phase 6 — shared blocks (`assets/styles/components/`)

Split today's `_surfaces.scss`, `_masters.scss` and `_auth.scss` into one
partial per block. Delete the three old files once everything they held has a
new home. Update the templates that use renamed classes in the same step
(`grep` each old class across `web/src/app/**/*.html` before deleting it).

**Conventions in the specs below:**
- **"no caps"** means remove `text-transform`, `letter-spacing` and any
  display font.
- **"overline"** means `@include overline`.
- Every weight is a `$fw-*` token.
- Every element that used to be styled through a tag selector (`i`, `span`,
  `p`, `dt`, `dd`, `strong`, `th`, `td`, `tr`) gets **its own element class**
  in the template.

### Class map for shared blocks

| Old | New | Partial |
| --- | --- | --- |
| `.page`, `.page__head/title/subtitle/actions` | unchanged | `_page.scss` |
| `.card`, `.card__head/title` | unchanged | `_card.scss` |
| `.card--pad` | `.card--padded` | `_card.scss` |
| `.card__hint` (waste, reports copies) | `.card__hint`, one definition | `_card.scss` |
| `.empty`, `.empty i`, `.empty__title` | `.empty-state`, `.empty-state__icon`, `.empty-state__title`, `.empty-state__text` | `_empty-state.scss` |
| `.skeletons` (6 copies) | `.skeleton-list` | `_skeleton-list.scss` |
| `.field`, `.field__label/hint/error` | unchanged, plus `.field--flush` (no bottom margin) | `_field.scss` |
| `input.field__input--lg` | `.field__input .field__input--lg` | `_primeng.scss` |
| `.field .p-password` | `.field__password` (via `styleClass`) | `_primeng.scss` |
| `.dialog__footer` | `.dialog-footer` | `_dialog-footer.scss` |
| `.stats`, `.tally` | `.kpi-grid` | `_kpi.scss` |
| `.stat`, `.stat--grade`, `.tally__item` | `.kpi` | `_kpi.scss` |
| `.stat--muted`, `.tally__item--muted` | `.kpi--muted` | `_kpi.scss` |
| `.stat__label`, `.tally__label` / `.stat__value`, `.tally__value` / `.tally__slash` | `.kpi__label` / `.kpi__value` / `.kpi__sub` | `_kpi.scss` |
| `.master__toolbar`, `.master__filters`, `.master__count` | `.master-toolbar`, `__filters`, `__count` | `_master-toolbar.scss` |
| p-table in masters and reports | `styleClass="data-table"` | `_data-table.scss` |
| `.master__sr`, `.master__meta`, `.numeric`, `<th style="width: 10rem">` | `.data-table__cell` plus `--index`, `--meta`, `--numeric`, `--actions` | `_data-table.scss` (the `td` specificity fight → `_primeng.scss`) |
| `.master__name`, `.master__na`, `.master__actions` | `.data-table__name`, `.data-table__empty-value`, `.data-table__actions` | `_data-table.scss` |
| `.shell__*`, including `i` children | `.shell__*`, plus `.shell__mark-icon`, `.shell__context-icon`, `.shell__link-icon`; drop `.tabular` from the clock | `_shell.scss` |
| `.auth` | `.auth-layout`, `__brand`, `__pane` | `_auth-layout.scss` |
| `.auth__brand-head/mark/wordmark/name/tagline/pitch/points/point` (+ `i`, `span`, `p`) | `.auth-brand` (mixed onto `.auth-layout__brand`), `__head`, `__mark`, `__mark-icon`, `__wordmark`, `__name`, `__tagline`, `__pitch`, `__points`, `__point`, `__point-icon`, `__point-title`, `__point-text` | `_auth-brand.scss` |
| `.auth__card(--narrow/--wide)`, `.auth__head/title/subtitle/grid/span/actions/submit/foot/link/aside` | `.auth-card(--narrow/--wide/--code)`, `.auth-card__*` | `_auth-card.scss` |
| `register.scss` `.auth__card .field:last-of-type` | `field--flush` on the last field of the grid | — |
| `register.scss` `.auth__card--code .auth__head` | `.auth-card--code .auth-card__head` | `_auth-card.scss` |
| `.auth__code-mark(--success)` (+ `i`) | `.auth-card__mark(--success)`, `.auth-card__mark-icon` | `_auth-card.scss` |
| `.auth__device`, `-title` (+ `i`, `p`) | `.device-notice`, `__icon`, `__body`, `__title`, `__text` | `_device-notice.scss` |
| `.meter(--weak/fair/good/strong)`, `.meter__step(--on)`, `.meter__label` | `.password-meter(--weak/fair/good/strong)`, `__steps`, `__step(--on)`, `__label` | `_password-meter.scss` |
| `.auth__otp-field`, `.auth__otp`, `.p-inputotp-input` | `.otp-field`, `.otp-field__input` (via `styleClass`), digit sizing | `_otp-field.scss` + `_primeng.scss` |

### Restyle specs

- **`_page.scss`**
  - `.page`: flex column, gap `$space-xl`, min-height 100%; the `> *` flex
    rule becomes `.page__section { flex: 0 0 auto; }`. Add that class to
    direct children only if a screen actually needs it; otherwise drop the
    rule.
  - `__head`: gap `$space-lg`, `align-items: flex-end`.
  - `__title`: `$fs-xl` semibold, no caps.
  - `__subtitle`: `$fs-base` `$text-muted`, margin-top `$space-xs`.
  - `__actions`: gap `$space-sm`.
- **`_card.scss`**
  - `.card`: `$surface-card`, `1px solid $border-subtle`, `$radius-lg`,
    `$shadow-card`.
  - `--padded`: padding `$space-xl`.
  - `__head`: padding `$space-lg $space-xl`, min-height 5.6rem, border-bottom
    `$border-subtle`.
  - `__title`: `$fs-md` semibold, no caps.
  - `__hint`: `$fs-sm` `$text-muted`.
- **`_empty-state.scss`**
  - Block: padding `$space-3xl $space-xl`, gap `$space-md`.
  - `__icon`: `$icon-hero`, `$border-strong`.
  - `__title`: `$fs-md` semibold `$text-secondary`.
  - `__text`: `$text-muted`, max-width 60ch.
- **`_skeleton-list.scss`:** flex column, gap `$space-sm`, padding
  `$space-lg $space-xl`.
- **`_field.scss`**
  - `.field`: gap `$space-sm`, margin-bottom `$space-lg`; `--flush`
    margin-bottom 0.
  - `__label`: `$fs-sm` medium `$text-secondary`, no caps.
  - `__hint`: `$fs-sm` `$text-muted`.
  - `__error`: `$fs-sm` medium `$danger-text`.
- **`_dialog-footer.scss`:** flex, end-aligned, gap `$space-sm`, padding-top
  `$space-md`.
- **`_kpi.scss`**

  ```scss
  // A row of headline numbers.
  .kpi-grid {
    display: grid;
    gap: $space-lg;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  }

  // One headline number. Inside a `grade-tone--N` its stripe takes that grade's
  // colour, otherwise the accent.
  .kpi {
    background: $surface-card;
    border: 1px solid $border-subtle;
    border-radius: $radius-lg;
    box-shadow: $shadow-card;
    display: flex;
    flex-direction: column;
    gap: $space-xs;
    overflow: hidden;
    padding: $space-lg $space-xl;
    position: relative;

    // Identity stripe, drawn rather than bordered so the radius stays clean.
    &::before {
      background: var(--grade-edge, #{$accent});
      content: '';
      inset: 0 auto 0 0;
      position: absolute;
      width: 0.4rem;
    }

    &--muted::before {
      background: $border-strong;
    }

    &__label {
      @include overline;
      color: $text-muted;
    }

    &__value {
      @include numeric;
      font-size: $fs-2xl;
      font-weight: $fw-semibold;
      letter-spacing: $ls-tight;
      line-height: $lh-tight;
    }

    &__sub {
      color: $text-faint;
      font-size: $fs-lg;
    }
  }
  ```

- **`_master-toolbar.scss`:** flex, space-between, wrap, gap `$space-md`;
  `__filters` gap `$space-md`; `__count` `$fs-sm` `$text-muted` numeric.
- **`_data-table.scss`**
  - `__cell--index`: width 5.6rem, `$text-faint`, numeric.
  - `__cell--meta`: `$fs-sm`.
  - `__cell--numeric`: right-aligned, numeric.
  - `__cell--actions`: width 10rem.
  - `__name`: medium.
  - `__empty-value`: `$text-faint`.
  - `__actions`: flex, end-aligned, gap `$space-2xs`.
- **`_primeng.scss`**, in addition to the rules above:
  `.data-table .p-datatable-tbody > tr > td.data-table__cell--index { color: $text-faint; }`
  and the same for `--meta` with `$text-muted`. PrimeNG's body-cell colour
  rule out-specifies a bare class.
- **`_shell.scss`** — medium slate sidebar, white topbar
  - `.shell`: grid unchanged; rows `$shell-topbar-height 1fr`.
  - `__brand`: `$sidebar-bg`; border-bottom and border-right
    `1px solid $sidebar-border`; padding `0 $space-lg`; gap `$space-md`.
  - `__mark`: 3.2rem square, `$radius-md`, `$accent`; no gradient or border.
  - `__mark-icon`: `$icon-md`, `$text-on-accent`.
  - `__name`: `$sidebar-active-text`, `$fs-base` semibold, no caps, truncate.
  - `__tagline`: `$sidebar-text-muted`, `$fs-xs`, no caps.
  - `__topbar`: `$surface-header`, border-bottom `$border-subtle`, padding
    `0 $space-2xl`.
  - `__context`: `$text-secondary`, `$fs-base` medium, no caps.
  - `__context-icon`: `$text-faint`, `$icon-md`.
  - `__clock`: `$text-muted`, `$fs-sm`, numeric.
  - `__user`: height `$control-h`, `1px solid $border-subtle`, pill, padding
    `0 $space-md 0 $space-xs`, gap `$space-sm`; transition
    `background, color` at `$duration-fast`; hover `$surface-hover` /
    `$text-primary`.
  - `__user-avatar`: 3.2rem circle, `$accent`, `$text-on-accent`, `$fs-xs`
    semibold.
  - `__user-name`: `$fs-sm` medium, truncate.
  - `__nav`: `$sidebar-bg`, border-right `$sidebar-border`, gap `$space-2xs`,
    padding `$space-lg $space-md`.
  - `__section`: overline, `$sidebar-text-muted`, margin
    `$space-xl 0 $space-xs $space-md`. First section margin-top 0: give the
    first one `shell__section--first` in the template (`@for` exposes
    `$first`) rather than `:first-child`.
  - `__link`
    - Base: height `$control-h`; padding `0 $space-md`; `$radius-md`; gap
      `$space-md`; `$fs-base` medium; `$sidebar-text`; no border.
    - Hover: `$sidebar-hover` background, `$sidebar-active-text`.
    - `--active`: `$sidebar-active-bg`, `$sidebar-active-text`, semibold,
      `box-shadow: inset 0.3rem 0 0 $sidebar-indicator`.
  - `__link-icon`: `$icon-md`, width 2rem, `$sidebar-text-muted`. For
    `.shell__link:hover .shell__link-icon` and
    `.shell__link--active .shell__link-icon`, use `$sidebar-active-text` and
    `$sidebar-indicator`.
  - `__main`: padding `$space-xl $space-2xl $space-2xl`.
  - ≤900px: horizontal nav; active becomes
    `box-shadow: inset 0 -0.3rem 0 $sidebar-indicator`; main padding
    `$space-lg`.
- **`_auth-layout.scss`:** grid `44rem 1fr`, height 100vh; `__pane`
  `$surface-page`, padding `$space-2xl`, centred, `overflow-y: auto`; ≤900px
  single column with the brand hidden.
- **`_auth-brand.scss`**
  - Block: `$sidebar-bg`, `$sidebar-text`, padding `$space-3xl`, gap
    `$space-2xl`, centred column. **No radial wash, no gradient, no border.**
  - `__mark`: 4rem, `$radius-md`, `$accent`; `__mark-icon` `$icon-lg`
    `$text-on-accent`.
  - `__name`: `$sidebar-active-text` `$fs-md` semibold.
  - `__tagline`: `$sidebar-text-muted` `$fs-sm`.
  - `__pitch`: `$sidebar-active-text`, `$fs-2xl` semibold, `$lh-tight`,
    `$ls-tight`, max-width 18ch.
  - `__points`: gap `$space-lg`.
  - `__point`: grid `2.4rem 1fr`, `$fs-base`.
  - `__point-icon`: `$sidebar-indicator` `$icon-lg`.
  - `__point-title`: `$sidebar-active-text` semibold.
  - `__point-text`: `$sidebar-text-muted` `$fs-sm`, grid-column 2.
- **`_auth-card.scss`**
  - Block: `$surface-card`, `1px solid $border-subtle`, `$radius-xl`,
    `$shadow-card`, padding `$space-2xl`.
  - Modifiers: `--narrow` max-width 42rem; `--wide` 60rem; `--code`
    `text-align: center`, with `.auth-card--code .auth-card__head` margin-bottom
    `$space-lg`.
  - `__head`: margin-bottom `$space-xl`.
  - `__title`: `$fs-xl` semibold.
  - `__subtitle`: `$fs-base` `$text-muted`.
  - `__grid`: two columns, gap `0 $space-lg` (one column ≤900px).
  - `__span`: full row.
  - `__actions`: column, gap `$space-md`, margin-top `$space-md`.
  - `__submit`: full width, centred (via `styleClass`).
  - `__foot`: border-top `$border-subtle`, `$text-muted`, `$fs-sm`,
    margin-top `$space-xl`, padding-top `$space-lg`.
  - `__link`: `$text-accent` semibold; hover underline.
  - `__aside`: flex space-between, margin-bottom `$space-lg`.
  - `__mark`: 5.6rem circle, `$accent-soft`, margin `0 auto $space-lg`;
    `__mark-icon` `$icon-xl` `$text-accent`;
    `.auth-card__mark--success .auth-card__mark-icon` → `$success-text`.
- **`_device-notice.scss`**
  - Block: flex, `$accent-soft`, `$radius-md`, padding `$space-md $space-lg`,
    gap `$space-md`, margin-bottom `$space-xl`. **No side bar.**
  - `__icon`: `$text-accent` `$icon-lg`.
  - `__title`: `$fs-sm` semibold `$text-primary`.
  - `__text`: `$fs-sm` `$text-muted`, max-width 56ch.
- **`_password-meter.scss`**
  - `__steps`: flex, gap `$space-xs`, margin-top `$space-xs`.
  - `__step`: 0.4rem tall, pill, `$border-subtle`.
  - Lit steps follow the block modifier:
    `.password-meter--weak .password-meter__step--on` `$danger`, `--fair`
    `$warning`, `--good` and `--strong` `$success`.
  - `__label`: `$fs-sm` `$text-muted`.
- **`_otp-field.scss`:** block is a centred column; `__input` is a centred
  flex row, gap `$space-sm`, margin-bottom `$space-sm`.
- **`_otp-field` digits (in `_primeng.scss`):**
  `.otp-field__input .p-inputotp-input` gets `$fs-xl` semibold,
  height 5.6rem, width 4.8rem, `$radius-md`, centred text. Keep the
  `display: flex !important` here with its comment.
- **`_grade-tone.scss`** — the `$tones` map; accent carries white text at ≥
  4.5:1; hover and active are darker:

  | # | Name | accent | hover | active | edge | soft (light) | soft (dark) | on-light | on-dark |
  | - | ---- | ------ | ----- | ------ | ---- | ------------ | ----------- | -------- | ------- |
  | 0 | blue | blue-600 | blue-700 | blue-800 | blue-500 | rgba(blue-600,.10) | rgba(blue-400,.18) | blue-700 | blue-400 |
  | 1 | red (scrap) | red-600 | red-700 | red-800 | red-500 | rgba(red-600,.10) | rgba(red-400,.18) | red-700 | red-400 |
  | 2 | amber | amber-700 | amber-800 | amber-900 | amber-500 | rgba(amber-600,.12) | rgba(amber-400,.18) | amber-800 | amber-400 |
  | 3 | green | green-700 | green-800 | green-900 | green-500 | rgba(green-600,.10) | rgba(green-400,.16) | green-800 | green-400 |
  | 4 | charcoal | gray-700 | gray-800 | gray-900 | gray-500 | rgba(gray-700,.10) | rgba(gray-400,.16) | gray-700 | gray-300 |
  | 5 | cyan | cyan-700 | cyan-800 | cyan-900 | cyan-500 | rgba(cyan-600,.12) | rgba(cyan-400,.18) | cyan-800 | cyan-400 |

## Phase 7 — shared components and screens

**Recipe, for every component below, one at a time:**

1. Create the partial and add `@use '<folder>/<name>';` to `main.scss`.
2. Rename classes in the template per the map. Every tag, descendant or
   structural selector becomes its own element class or a modifier.
3. Write the rules (restyled per the spec) in the partial. Nest with
   `&__element` / `&--modifier`, never more than block → element/modifier →
   pseudo.
4. Remove `styleUrl` from the component `.ts`, and delete the component
   `.scss`.
5. `npm run web:build`.

### `shared/_scan-field.scss` (component `shared/scan-field`)

The spec file queries by tag (`input`, `button`), so renaming is safe.

- **Map:**
  - `.scanbox*` → `.scan-field*`
  - label `i` → `.scan-field__label-icon`
  - result `strong` → `.scan-field__result-value`
- **Restyle:**
  - `__label`: `$fs-sm` medium `$text-secondary`, no caps.
  - `__label-icon`: `$icon-md`, `var(--grade-accent, #{$accent})`.
  - `__input`
    - Height `$control-h-lg`, `$surface-card`, `1px solid $border-strong`,
      `$radius-md`.
    - Mono `$fs-md` with letter-spacing 0.04em (the one allowed tracking
      literal, for code legibility).
    - Padding `0 $space-md`.
    - Placeholder: body font `$fs-base` `$text-faint`.
    - Focus: border `$accent` plus `@include focus-ring`.
  - `__result--ok` `$success-text`; `--problem` `$warning-text`.
  - `__dismiss`, `__hint`: `$fs-sm` `$text-muted`.

### `shared/_range-filter.scss`

- **Map:**
  - `.filter*` → `.range-filter*`
  - `.filter__input` / `.filter__select` → `.range-filter__input` /
    `.range-filter__select` (via `styleClass`)
  - Drop `:host ::ng-deep`. If a width doesn't reach PrimeNG's inner input,
    scope it in `_primeng.scss` under that class.
- **Restyle:**
  - `__preset`: height `$control-h`, padding `0 $space-lg`, `$surface-card`,
    `$border-default`, `$fs-sm` medium, no caps, transition
    `background, color, border-color` at `$duration-fast`.
  - `__preset--first` / `--last` modifiers carry the outer radii (template
    uses `$first` / `$last`), replacing `:first-child` / `:last-child` /
    `:not(:first-child)`.
  - `__preset--active`: `$accent` background and border, `$text-on-accent`.
  - `__label`: `$fs-sm` medium `$text-secondary`.
  - `__input` width 14rem; `__select` min-width 16rem.

### `views/_waste.scss`

- **Map:**
  - `.tally*` → `.kpi-grid` / `.kpi*`
  - `.reasons*` → `.reason-chips`, `__chip`, `__chip--active`, `__name`,
    `__count`
  - `.tapper*` stays, plus `.tapper__row--crowded` set in the template when
    the grade count is ≥ 4 (replaces the `:has()` rule)
  - `.grade*` → `.grade-counter`, `--empty`, `__undo`, `__undo-icon`,
    `__count`, `__add`, `__add-icon`, `__label`
  - `.skeletons` → `.skeleton-list`
- **Restyle:**
  - `.reason-chips__chip`
    - Height `$control-h`, padding `0 $space-lg`, gap `$space-sm`,
      `$surface-card`, `$border-default`, `$text-secondary`.
    - Transition `background, color, border-color` at `$duration-fast`.
    - `--active`: `$accent`, `$text-on-accent`, no glow.
  - `__name`: `$fs-base` medium, no caps (reason names show as typed).
  - `__count`: `$fs-xs` semibold numeric, `$wash-inset`, padding
    `$space-2xs $space-sm`; `.reason-chips__chip--active .reason-chips__count`
    → `$wash-on-accent`.
  - `.tapper__row`: padding `$space-md $space-xl`, gap `$space-lg`, hover
    `$wash-hover`. Add `--last` for the no-border last row, instead of
    `:last-child`.
  - `__sr`: `$fs-base` `$text-faint` numeric.
  - `__name`: `$fs-md` semibold truncate.
  - `__series`: `$fs-sm` `$text-muted`.
  - `__total-label`: overline `$text-faint`.
  - `__total-value`: `$fs-lg` semibold numeric.
  - `.tapper__row--crowded .grade-counter__label` → `display: none` inside
    the ≤1500px media query.
  - `.grade-counter`: `$surface-card`, `$border-default`, `$radius-md`;
    `.grade-counter--empty .grade-counter__count` → `$text-faint`.
  - `__undo`: width 4rem, `$text-muted`, hover
    `var(--grade-soft, #{$danger-soft})` / `var(--grade-bright, #{$danger-text})`.
  - `__count`: `$fs-lg` semibold numeric, min-width 5.6rem.
  - `__add`
    - Min-height `$control-h-lg`, padding `0 $space-lg`, gap `$space-sm`,
      `$fs-base` semibold, no caps.
    - Background `var(--grade-accent, #{$accent})`, `$text-on-accent`;
      hover/active use `--grade-accent-hover` / `--grade-accent-active`.
    - Transition `background` at `$duration-fast`; `:active`
      `translateY(1px)`.
    - No border-left.
  - `__add-icon`: `$icon-sm`.

### `views/_barcodes.scss`

- **Map:**
  - `.scan` → `.scan-page`; `__bar/tools/select/search/empty/box` →
    `.scan-page__*`
  - `.scan__status` → `.scan-status` (`--problem`)
  - `.scan__state(--ok/--problem)` → `.scan-status__state(--ok/--problem)`;
    its `> i` → `__state-icon`, `> div` → `__state-body`, `strong` →
    `__state-value`; plus `__state-label`, `__state-grade`
  - `.scan__recent*` → `.scan-status__recent`, `__recent-row`, plus
    `__recent-row--latest` (replaces `:first-child`), `__recent-time`,
    `__recent-reason`, `__recent-grade`, `__recent-empty`
  - `.jumps*` → `.jump-links`, `__label`, `__chip`
  - `.matrix` → `.scan-matrix`; `.grid` → `.scan-matrix__table`;
    `.col--sr/worker/series/cell` → `.scan-matrix__col` plus
    `--sr/--worker/--series/--cell`
  - Header and body cells → `__group`, `__grade-head`, `__sr`, `__worker`,
    `__series` (`--head` for the thead corner cells), `__cell`; rows → `__row`
  - `.tile*` → `.barcode-tile`, `__bars`, `__quiet`, `__bar`, `__caption`,
    `__code`, `__count`, `__count--on`
- **Restyle:**
  - `.scan-status`
    - Flat `$surface-card`, `$border-subtle`, `$radius-lg`, padding
      `$space-md $space-lg`.
    - Stripe `box-shadow: inset 0.4rem 0 0 $success`; `--problem` uses
      `$warning`.
  - `__state-icon`: `$icon-xl` `$text-faint`; `__state--ok` icon
    `$success-text`; `__state--problem` icon and value `$warning-text`.
  - `__state-label`: overline `$text-muted`.
  - `__state-value`: `$fs-lg` semibold.
  - `__state-grade`: `$fs-sm` medium `var(--grade-bright, #{$text-accent})`.
  - `__recent-row`: `$fs-sm` numeric; `--latest` `$success-text`.
  - `.scan-page__select`, `__search`: height `$control-h`, padding
    `0 $space-md`, `$radius-md`, `$border-default`, `$fs-base`, width 16rem;
    focus `$accent` border plus `@include focus-ring`.
  - `.jump-links__label`: overline.
  - `__chip`: height `$control-h-sm`, padding `0 $space-md`, `$fs-sm` medium,
    no caps.
  - `.scan-matrix__table`: all cell element classes share
    `border-bottom/right: 1px solid $border-subtle` (list them in one
    comma-separated rule).
  - Header cells: `$band-strong` / `$band`, `$band-text`, `$fs-sm` semibold,
    no caps.
  - `__grade-head`: `$fs-xs` medium `$band-text-muted`, bottom rule
    `var(--grade-edge, #{$accent})`.
  - `__worker`: medium.
  - `__series`: `$fs-sm` `$text-muted`.
  - Row hover: `.scan-matrix__row:hover .scan-matrix__sr` (and `__worker`,
    `__series`, `__cell`) → `$surface-hover`.
  - `.barcode-tile`: literals become `$white` / `$black`; `__code` `$gray-500`;
    `__count` `$gray-400`; `__count--on` `var(--grade-accent, #{$accent})`.
    Tile font sizes 0.85rem and 1rem stay as geometry.

### `views/_month-sheet.scss` (component `views/sheet`)

- **Map:**
  - `.sheet` → `.month-sheet`; `__scroll`; `__notice` (via `styleClass` on
    `p-message`, no `::ng-deep`)
  - `<table>` → `__table`
  - Every `thead th` → `__head-cell`, plus its specific element (`__sr--head`,
    `__worker--head`, `__group`, `__group--total`, `__sub`, `__sub--total`,
    `__sub--edge`)
  - Body: `__row`, `__sr`, `__worker`, `__series`, `__box`, `__box--edge`,
    `__box--total`; `tfoot td` → `__foot-cell`
- **Restyle:**
  - Every cell class: border `1px solid $border-subtle`, padding
    `$space-xs $space-sm`, nowrap.
  - `__head-cell`: `$band-strong`, `$band-text`, `$fs-sm` semibold, sticky
    top.
  - `__group`: `$band` (`--total` `$band-strong`).
  - `__sub`: `$band-strong`, `$band-text-muted`, `$fs-xs` medium; `--total`
    `$band-text`; `--edge` border-right `$band-divider`.
  - `__box`: centred numeric; `--edge` `$border-strong`; `--total`
    `$wash-inset` semibold.
  - `.month-sheet__row:nth-child(even) .month-sheet__box` → `$wash-hover`,
    and the same for the pinned `__sr` / `__worker` cells → `$surface-hover`.
  - `__foot-cell`: `$band`, **`color: $band-text`**, semibold, numeric,
    sticky bottom.
  - Declare modifiers after base classes and **drop every `!important`**;
    equal single-class specificity plus source order does the job now.

### `views/_reports.scss`

- **Map:**
  - `.stats` / `.stat*` → `.kpi-grid` / `.kpi*`
  - `.split` → `.report-split`
  - `.breakdown*` stays
  - `.top*` → `.top-workers*`
  - `.entry-grade` → `.grade-badge`
  - `.numeric` → `.data-table__cell--numeric`
  - `.card__hint` → global
- **Restyle:**
  - `.breakdown__row`: padding `$space-sm $space-xl`.
  - `__bar`: flat `var(--grade-soft, #{$accent-soft})`, `$radius-sm`.
  - `__name`: `$fs-base` medium, no caps.
  - `__count`: semibold numeric `var(--grade-bright, #{$text-accent})`.
  - `__total`: semibold numeric.
  - `__share`: `$fs-sm` `$text-muted` numeric.
  - `.top-workers__row`: padding `$space-sm $space-xl`, `--last` modifier.
  - `__rank`: `$fs-base` `$text-faint` numeric.
  - `__name`: medium.
  - `__series`: `$fs-sm` `$text-muted`.
  - `__total`: `$fs-md` semibold numeric.
  - `.grade-badge`: `$fs-sm` medium, padding `$space-2xs $space-sm`, pill,
    `var(--grade-soft)` / `var(--grade-bright)`, no border.

### `views/_profile.scss`

- **Map:**
  - Account card → `.profile`: `__columns`, `__identity`, `__avatar`,
    `__name`, `__company`, `__facts`, `__fact-term` (was `dt`), `__fact-value`
    (was `dd`), `__device`, `__bound`, `__bound-icon`, `__reference`
  - Subscription card → `.subscription`: `__head`, `__eyebrow`, `__plan`,
    `__days`, `__days-count` (`--expired` replaces
    `.profile__days--out .profile__days-count`), `__days-label`, `__bar`,
    `__bar-fill`, `__message` (replaces `.profile__facts + p-message`),
    `__view-plans`
  - Plans dialog → `.plans-dialog`: `__head`, `__eyebrow`, `__title`,
    `__body`, `__grid`
  - Each plan → `.plan-card`: `--best`, `__ribbon`, `__name`, `__price`,
    `__amount`, `__term`, `__button`
- **Restyle:**
  - `.profile__avatar`: flat `$accent`, `$text-on-accent`, `$fs-lg` semibold.
  - `__name`: `$fs-lg` semibold.
  - `__fact-term`: `$fs-sm` medium `$text-muted`.
  - `__device`, `__reference`: mono `$fs-sm`.
  - `.subscription__eyebrow`, `.plans-dialog__eyebrow`: overline
    `$text-muted`.
  - `__plan`: `$fs-lg` semibold.
  - `__days-count`: `$text-accent` `$fs-2xl` semibold numeric; `--expired`
    `$danger-text`.
  - `__days-label`: `$fs-sm` `$text-muted`.
  - `__bar-fill`: `$accent`.
  - `.plans-dialog__title`: `$fs-xl` semibold.
  - `__grid`: gap `$space-lg`, same breakpoints.
  - `.plan-card`
    - `$surface-card`, `$border-subtle`, `$radius-lg`, padding `$space-xl`.
    - Hover: border `$border-strong` only; **no translate, no shadow**.
    - `--best`: border `$accent`.
  - `__ribbon`: `$accent`, `$text-on-accent`, overline.
  - `__name`: `$fs-sm` semibold `$text-secondary`.
  - `__amount`: `$text-primary` `$fs-2xl` semibold numeric.
  - `__term`: `$fs-sm` `$text-muted`.

### Smaller screens

- **`views/_reasons.scss`:** `.reasons-list*` → `.reason-list`, `__row`
  (`--last`), `__pos`, `__name`, `__order`. Row padding `$space-md $space-xl`;
  `__pos` `$fs-base` faint numeric; `__name` `$fs-base` medium, no caps.
- **`views/_grades.scss`:** `.grade-chip`, `__swatch` stay; swatch 1.6rem,
  `$radius-sm`.
- **`views/_settings.scss`:** `.settings__*` stay; `dt` / `dd` →
  `__fact-term` / `__fact-value`; warning `i` → `__warning-icon`.
  `__fact-term` `$fs-sm` medium `$text-muted`; `__warning` `$warning-text`;
  `__path` mono `$fs-sm`.
- **`views/_login.scss`:** forgot-password dialog → `.forgot-password`,
  `__note`, `__done`, `__done-icon` (was `i`), `__aside`. `__done-icon`
  `$success-text` `$icon-lg`.
- **`views/_workers.scss`:** `.form__grid` / `.form__span` → `.worker-form__grid`
  / `.worker-form__span`; `.worker__phone` → `.data-table__cell--phone` in
  `_data-table.scss` (numeric, left-aligned). Delete this file if nothing else
  remains.
- **`register.scss`** and **`series.scss`**: nothing screen-specific survives
  (both moved to shared blocks). Just remove `styleUrl` and delete them.

### Inline styles and dialog widths

Replace `style="width: 10rem"` on `<th>` (workers, series, grades) with
`data-table__cell data-table__cell--actions`.

Add to `web/src/app/models/constants.ts`:

```ts
// Dialog widths, sized for the 15px base text. The plans dialog keeps its own vw sizing.
export const DIALOG_WIDTH = { confirm: '40rem', form: '40rem', formWide: '52rem', account: '44rem' } as const;
```

Expose it as a `protected readonly` field and bind `[style]="{ width: DIALOG_WIDTH.x }"`:

| Template | Width |
| --- | --- |
| `app.html` confirm dialog | `confirm` |
| reasons, series, grades dialogs | `form` |
| workers dialog | `formWide` |
| login forgot-password, profile change-password | `account` |

`[style]` bindings that carry **data** stay (`[style.width.%]`,
`[style.--grid-columns]`); they aren't styling.

### Casing check

With CSS uppercase gone, skim `web/src/assets/i18n/en.json` for strings that
only looked right because the CSS uppercased them. Make them sentence case;
leave `3rd` / `4th` style abbreviations alone.

## Phase 8 — verify

1. `npm run web:build` from the root. No errors, no new warnings over the
   Phase 0 baseline.
2. `cd web && npm test -- --watch=false`. The four spec files pass.
3. **Grep gates** under `web/src`:

   | Check | Expected |
   | --- | --- |
   | Glob `web/src/app/**/*.{scss,css}` | no files |
   | `styleUrls?:\|styles:\s*[\[\`]` in `app/**/*.ts` | none |
   | `:host\|::ng-deep` | none |
   | `style="` in `app/**/*.html` | none |
   | `g-tone` | none |
   | `__[a-z0-9-]+__` in styles | none (no element-of-element) |
   | `\.p-[a-z]` in `assets/styles` | only `components/_primeng.scss` |
   | `!important` | only `components/_primeng.scss` |
   | `(^\|[\s,>+~])(a\|button\|dd\|div\|dt\|h[1-6]\|i\|input\|li\|p\|span\|strong\|svg\|table\|tbody\|td\|tfoot\|th\|thead\|tr\|ul)([\s,.:>{[]\|$)` in `assets/styles` | only `base/_reset.scss` |
   | `#[a-zA-Z][\w-]*\s*[{,]` (id selectors) | none |
   | `:first-child\|:last-child\|:has\(` | none (use modifiers) |
   | `\$font-display\|Oswald` | none |
   | `\$(navy\|ink\|violet\|teal)-` | only the TEMPORARY block (gone in Phase 9) |
   | `text-transform` | `base/_tokens.scss` only |
   | `letter-spacing` | `_tokens.scss`, `_reset.scss`, `shared/_scan-field.scss`, `views/_barcodes.scss` tile |
   | `gradient\(` | none |
   | `transition:\s*all` | none |
   | `\$(blue\|gray\|slate\|red\|amber\|green\|cyan)-\d` | `base/`, `components/_grade-tone.scss`, `.barcode-tile` in `views/_barcodes.scss` |
   | `font-size:\s*[0-9]` | `.barcode-tile__code` / `__count` only |
   | `font-weight:\s*[0-9]` | `base/_tokens.scss` only |

4. **Contrast.** Save as a scratch file (don't commit) and run with `node`.
   Every line must print `ok`.

   ```js
   // WCAG 2.x contrast for the theme's key text/background pairs.
   const rgb = (h) => h.match(/\w\w/g).map((c) => parseInt(c, 16) / 255);
   // sRGB channel to linear light.
   const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
   const lum = (h) => {
     const [r, g, b] = rgb(h).map(lin);
     return 0.2126 * r + 0.7152 * g + 0.0722 * b;
   };
   const ratio = (a, b) => {
     const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
     return (hi + 0.05) / (lo + 0.05);
   };
   // [label, foreground, background, minimum]
   const pairs = [
     ['L primary / page', '#262c35', '#f0f2f5', 7],
     ['L primary / card', '#262c35', '#ffffff', 7],
     ['L secondary / card', '#3f4753', '#ffffff', 7],
     ['L muted / page', '#58616d', '#f0f2f5', 4.5],
     ['L muted / sunken', '#58616d', '#e3e6eb', 4.5],
     ['L faint / card', '#7c8491', '#ffffff', 3],
     ['L faint / page', '#7c8491', '#f0f2f5', 3],
     ['L accent text / card', '#1d4ed8', '#ffffff', 4.5],
     ['L table head', '#58616d', '#f7f8fa', 4.5],
     ['L danger text', '#b91c1c', '#ffffff', 4.5],
     ['L warning text', '#b45309', '#ffffff', 4.5],
     ['L success text', '#15803d', '#ffffff', 4.5],
     ['white / accent', '#ffffff', '#2563eb', 4.5],
     ['sidebar text / slate-600', '#e2e8f0', '#475569', 4.5],
     ['sidebar muted / slate-600', '#cbd5e1', '#475569', 4.5],
     ['sidebar active / slate-600', '#ffffff', '#475569', 4.5],
     ['white / band-strong (L)', '#ffffff', '#475569', 4.5],
     ['white / band (L)', '#ffffff', '#55657a', 4.5],
     ['band muted / band (L)', '#e2e8f0', '#55657a', 4.5],
     ['white / grade blue', '#ffffff', '#2563eb', 4.5],
     ['white / grade red', '#ffffff', '#dc2626', 4.5],
     ['white / grade amber', '#ffffff', '#b45309', 4.5],
     ['white / grade green', '#ffffff', '#15803d', 4.5],
     ['white / grade charcoal', '#ffffff', '#3f4753', 4.5],
     ['white / grade cyan', '#ffffff', '#0e7490', 4.5],
     ['D primary / page', '#f7f8fa', '#1d222a', 7],
     ['D muted / card', '#a3abb6', '#262c35', 4.5],
     ['D faint / card', '#7c8491', '#262c35', 3],
     ['D accent text / card', '#60a5fa', '#262c35', 4.5],
     ['D danger text / card', '#f87171', '#262c35', 4.5],
     ['D warning text / card', '#fbbf24', '#262c35', 4.5],
     ['D success text / card', '#4ade80', '#262c35', 4.5],
     ['D table head', '#a3abb6', '#2f3540', 4.5],
     ['D sidebar text / slate-700', '#e2e8f0', '#334155', 4.5],
   ];
   for (const [label, fg, bg, min] of pairs) {
     const r = ratio(fg, bg);
     console.log(r >= min ? 'ok  ' : 'FAIL', r.toFixed(2), label);
   }
   ```

   If a pair fails, adjust the palette step in **both** `_tokens.scss` and
   `theme.ts` and update the rule.

5. **Visual, outside Tauri.** `npm run web:start` from the root, then open
   `http://localhost:4200` in the Browser pane. Only login and register render
   (IPC fails outside Tauri, which is expected; judge styling only).
   Screenshot at 1440×900 and 1024×640.
6. **Visual, in Tauri.** Everything behind the shell. Hand this to the user:

   ```powershell
   $env:WORKER_LOG_DB = "$env:TEMP\worker-log-theme.db"; npm run dev
   ```

   Then Settings → Load demo data, and walk the checklist:

   - [ ] **Overall:** the app reads medium-toned — soft grey page, white
     cards, slate sidebar; nothing near-black.
   - [ ] **Shell:** one continuous slate sidebar; active link has a light
     inset bar and brighter background; white topbar; the only caps are the
     sidebar section overlines.
   - [ ] **Waste log:**
     - KPI stripes in grade colours; active reason chip solid blue.
     - Each worker row fits one line at 1440px; grade buttons ≥ 48px tall.
     - With 4+ grades the button labels hide below 1500px.
   - [ ] **Month sheet:** slate header bands; footer totals white on slate;
     pinned columns opaque while scrolling; zebra rows.
   - [ ] **Scanning sheet:**
     - Status stripe green, then amber after a bad scan (type `123`); problem
       text readable.
     - Tiles black on white; headers pinned; jump chips scroll to a reason.
   - [ ] **Reports:** KPIs, flat breakdown bars, top workers, entry history
     with a light-grey table header and grade badges.
   - [ ] **Masters (workers, series, reasons, grades):**
     - Light table header; muted index and meta columns; row hover.
     - Create with an empty name shows the error in readable red.
     - Dialogs not cramped.
   - [ ] **Settings, Profile** (plans dialog, change password), **Login**
     (forgot password + OTP), **Register** (both steps): login does *not*
     pick up register-only spacing.
   - [ ] **Overlays:** toast, confirm dialog, tooltip, date picker, select
     dropdown.
   - [ ] **Window chrome:** no dark flash on launch.
   - [ ] **Dim theme:** temporarily add `class="app-dark"` to `<html>`, do a
     quick pass, revert.

## Phase 9 — clean up and ship

1. Delete the TEMPORARY alias block from `_tokens.scss`, and delete the now
   empty `_surfaces.scss`, `_masters.scss`, `_auth.scss` and `_grades.scss` if
   any linger. Rebuild, then re-run the grep gates.
2. Delete the `> Pending:` lines at the top of `.claude/rules/theming.md`,
   `.claude/rules/ui-design-system.md` and `.claude/rules/angular-ui.md`.
   Re-read all three against what shipped and fix any drift.
3. `.claude/skills/supabase/registration.md` (around line 143) names
   `assets/styles/components/_auth.scss`. Point it at the `_auth-*`,
   `_password-meter` and `_otp-field` partials.
4. README: rewrite the "Theming" section and the "Tech" paragraph:
   - navy → blue/grey with medium slate chrome
   - Oswald + Inter → Inter Variable
   - grade 0/1 are blue/red
   - all CSS lives in `assets/styles` as BEM partials
5. Delete this plan file.
6. Commit on `theme-refresh`.
