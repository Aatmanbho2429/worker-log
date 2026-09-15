---
paths:
  - "web/src/**/*.scss"
  - "web/src/app/**/*.html"
  - "web/src/app/**/*.ts"
  - "web/src/app/theme.ts"
---

# UI design system

> Pending: introduced by `.claude/plans/theme-refresh.md`. Until that plan
> ships, some tokens, mixins, partials and classes named here do not exist
> yet. Delete this line once it does.

The look: calm, modern, **medium-toned** industrial.

- A soft grey page with white cards.
- A medium slate sidebar.
- Dark grey text rather than black.
- Blue only where something can be clicked or is selected.

Never stark white-on-black, never near-black chrome. The app runs on a
shop-floor monitor, read from arm's length and often tapped with gloves, so
size and contrast beat density. Colour rules are in `theming.md`; this file
covers everything else.

## Where CSS lives

**Angular components have no stylesheets.**
- No `styleUrl`, no `styles`, no component `.scss` / `.css`, no `:host`, no
  `::ng-deep`.
- `ng generate component` is configured with `"style": "none"`.
- To style a component's host element, give it a class in the decorator
  (`host: { class: 'block-name' }`) and style that class.

All custom CSS lives in SCSS partials under `web/src/assets/styles/`, pulled in
by `main.scss`:

```
web/src/assets/styles/
├── main.scss        the only entry; @use order: base → components → shared → views
├── base/            _tokens.scss (no CSS output) · _theme.scss · _reset.scss
├── components/      one partial per shared BEM block; file name = block name
│                    (_shell, _page, _card, _kpi, _field, _data-table, _grade-tone, …)
│                    plus _primeng.scss for scoped PrimeNG internals
├── shared/          one partial per shared Angular component (_scan-field, _range-filter)
└── views/           one partial per screen (_waste, _barcodes, _month-sheet, …)
```

- Each partial starts `@use 'base/tokens' as *;`. Register a new partial in
  `main.scss` in the right group.
- A block used by one screen lives in that screen's `views/` partial. Once a
  second screen needs it, move it to `components/` as its own file.
- Every class is global, so **block names must be unique app-wide.** Pick
  specific names (`scan-matrix`, `reason-chips`, `plan-card`), never generic
  ones (`grid`, `list`, `top`, `filter`).

## BEM

- **Syntax:** `.block`, `.block__element`, `.block--modifier`,
  `.block__element--modifier`. Lowercase kebab-case words
  (`.scan-status__recent-row--latest`).
- **One element level.** Never `.block__element__child`; name it
  `.block__child` or `.block__element-child`.
- **Modifiers never appear alone:** `class="kpi kpi--muted"`, not
  `class="kpi--muted"`.
- **State is a modifier** (`--active`, `--expired`, `--latest`), not `is-*`,
  and not a structural pseudo-class doing a modifier's job: no
  `:first-child`, `:last-child` or `:has()`. Set the modifier from the
  template (`@for` gives `$first` / `$last`; bind with
  `[class.block__el--mod]="cond"`).
- **Style classes only.** No tag, id or attribute selectors, and no styling of
  another block's internals. Every styled node in a template gets its own
  class, including the `i`, `span`, `dt` and `td` that used to be reached
  through a parent.
- **Allowed combinations:**
  - `.block--modifier .block__element` — a block state changes its element.
  - `.block__row:hover .block__cell` — hover within one block.
  - `.block__row:nth-child(even) .block__cell` — zebra striping.
  - Pseudo-classes and pseudo-elements on the class itself (`:hover`,
    `:focus-visible`, `::before`, `::placeholder`).
- **Mixes** are fine. A node can be an element of its parent block and a block
  of its own (`class="auth-layout__brand auth-brand"`). The parent element
  class positions it; its own block class styles its look.
- **Sass nesting** writes the names — `&__element`, `&--modifier`,
  `&:hover` — never deeper than block → element/modifier → pseudo.
- **Specificity stays at one class.** Declare modifiers after their base so
  source order wins. `!important` is not used outside `_primeng.scss`.
- **Theme contexts are BEM too:** grade tones are
  `grade-tone grade-tone--N`, returned by `core/grade-tone.ts`.
- **PrimeNG internals** (`.p-*`) are reached only in
  `components/_primeng.scss`, always scoped under an app BEM class passed via
  `styleClass` or `class`, e.g. `.otp-field__input .p-inputotp-input`. Each
  rule carries a one-line comment saying why. App-wide PrimeNG appearance
  belongs in `app/theme.ts`, not in CSS.
- **Inline `style`** in templates is only for data-driven values
  (`[style.width.%]="share"`, `[style.--grid-columns]`) and PrimeNG's own
  `[style]` input. Dialog widths come from `DIALOG_WIDTH` in
  `models/constants.ts`. Never `style="…"` for looks.

## Tokens, never literals

Everything comes from `base/_tokens.scss`. A partial never writes a literal
for any of these:

- font size, weight or letter-spacing
- padding, margin or gap
- radius, colour or transition duration

The only exceptions are fixed geometry (column widths, sticky offsets, tile
sizes) and the `.barcode-tile` block.

Mixins: `overline`, `numeric`, `focus-ring`, `truncate`. There are no utility
classes; include the mixin in the block that needs it.

## Typography

- One family, `$font-body` (Inter Variable, self-hosted via
  `@fontsource-variable/inter`).
- `$font-mono` is for machine strings only: barcode digits, device ids,
  payment references, file paths.

| Role | Size | Weight | Notes |
| --- | --- | --- | --- |
| Page title | `$fs-xl` 24px | semibold | `$ls-tight` (via `h1`) |
| Dialog / section title | `$fs-lg` 20px | semibold | |
| Card title, names on the waste screen | `$fs-md` 17px | semibold | |
| Body, table cells, inputs, buttons, nav | `$fs-base` 15px | regular (buttons and nav: medium/semibold) | |
| Secondary, meta, hints, field labels, dense grids | `$fs-sm` 13px | regular (labels: medium) | |
| Overline (KPI label, sidebar section) | `$fs-xs` 12px | `@include overline` | the only uppercase |
| KPI value | `$fs-2xl` 32px | semibold | `@include numeric` |
| Count on a grade counter, totals | `$fs-lg` 20px | semibold | `@include numeric` |

- **Case.** Sentence case everywhere. Uppercase appears only inside the
  `overline` mixin, and never on names (workers, reasons, grades, series),
  buttons or titles.
- **Tracking.** No letter-spacing except `$ls-tight` on large titles and the
  overline.
- **Numbers.** Anything that lines up or ticks gets `@include numeric`.
  Numeric table columns use `data-table__cell--numeric` (right-aligned).
- **Minimum size.** `$fs-sm` is the floor for anything an operator must read
  to act; `$fs-xs` is only for overlines. The barcode tile caption is the one
  thing smaller.
- **Weight.** 400 body, 500 names/labels/nav, 600 titles/buttons/values. No
  700.
- Running text is capped at `max-width: 70ch`.

## Spacing

The 4px grid: `$space-2xs` 2 · `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 ·
`2xl` 32 · `3xl` 48.

| Where | Token |
| --- | --- |
| Shell main padding | `$space-xl $space-2xl` |
| Between sections of a page (`.page` gap) | `$space-xl` |
| Card body (`.card--padded`) | `$space-xl` |
| Card head | `$space-lg $space-xl` |
| Table cell / list row | `$space-md $space-lg` (PrimeNG preset matches) |
| Label → input (`.field` gap) | `$space-sm` |
| Field → next field | `$space-lg` |
| Controls in a row | `$space-sm`; groups of controls `$space-md` |
| KPI tiles apart | `$space-lg` |

Use `gap` on the flex or grid parent rather than margins on children.

## Sizes

- **Control height:** `$control-h-sm` 32 · `$control-h` 40 (default) ·
  `$control-h-lg` 48. Anything tapped on the floor (grade buttons, scan
  inputs) is at least `$control-h-lg`.
- **Icons:** `$icon-sm` 14 · `$icon-md` 16 default · `$icon-lg` 20 status ·
  `$icon-xl` 24 · `$icon-hero` 32 empty states.
- **Radius:**
  - `$radius-sm` 4 — tags, swatches, tiles
  - `$radius-md` 6 — buttons, inputs, nav links
  - `$radius-lg` 8 — cards, KPIs
  - `$radius-xl` 12 — dialogs, the auth card
  - `$radius-pill` — chips, avatars, badges
- **Motion:**
  - Name the properties in `transition`, never `all`.
  - `$duration-fast` for hover, `$duration-base` for anything larger.
  - Hover never moves things; the only transform is `translateY(1px)` on
    `:active` for tap feedback.

## Screen anatomy

Signed-in screens compose the shared blocks in `components/`. Don't restyle
them in a view partial.

```html
<section class="page">
  <header class="page__head">
    <div>
      <h1 class="page__title">…</h1>
      <p class="page__subtitle">…</p>
    </div>
    <div class="page__actions">…</div>
  </header>

  <div class="kpi-grid">                                   <!-- optional -->
    <article class="kpi" [class]="gradeToneClass(i)">
      <span class="kpi__label">…</span>
      <span class="kpi__value">…</span>
    </article>
  </div>

  <div class="card">
    <div class="card__head">
      <h2 class="card__title">…</h2>
      <span class="card__hint">…</span>
    </div>
    <p-table styleClass="data-table">…</p-table>  <!-- or a padded card: class="card card--padded" -->
  </div>
</section>
```

- **Loading:** `.skeleton-list` holding `p-skeleton` rows.
- **Empty:** `.empty-state` with `__icon`, `__title`, one `__text` line, and at
  most one action.
- **Forms:** in a `p-dialog`, with `.field` / `__label` / `__hint` / `__error`
  (`--flush` on a last field) and a `.dialog-footer`.
- **Data tables:**
  - `p-table styleClass="data-table"` in a card: light grey header from the
    preset, no vertical rules.
  - Cells are `data-table__cell` plus `--index`, `--meta`, `--numeric` or
    `--actions`.
  - Row actions are icon text buttons with a tooltip (`severity="secondary"`,
    or `"danger"` for delete) inside `.data-table__actions`.
- **Register grids:** only the month sheet and the scanning matrix get slate
  `$band` headers, vertical rules and zebra rows, because they imitate the
  paper register.

## Keep it uncluttered

- **One solid blue button** per region; everything else is secondary or text.
- **Colour has a meaning.**
  - Blue means interactive or selected; don't colour headings, borders or
    icons blue for decoration.
  - Status colours are only for status; grade colours are only for grade
    identity.
- **No decoration.**
  - No gradients, glows or decorative side bars.
  - The only coloured stripe is identity (a grade or KPI tile) or status (the
    scan panel), drawn with `::before` or an inset `box-shadow`.
- **Cards.** A card is `1px $border-subtle` plus `$shadow-card`. Don't nest
  cards; divide a card's inside with space or a `$border-subtle` rule.
- **Icons** go where they speed recognition (nav, status, empty states,
  icon-only row actions), not beside every label.
- **Hint text** only when it prevents a mistake.
- **Text colours:** at most three per block: primary, muted, and one of
  accent, status or grade.

## States and accessibility

- **Contrast (WCAG).**
  - Primary text on page and cards ≥ 7:1.
  - Muted, secondary, accent and status text, and any text on the medium
    slate chrome (sidebar, bands), ≥ 4.5:1.
  - `$text-faint` (≥ 3:1) is only for placeholders, disabled text and
    separators.
- **Focus.** Every interactive element shows it: the global `:focus-visible`
  outline, or `@include focus-ring` on a hand-rolled input.
- **Hover** is `$surface-hover` or `$wash-hover`. **Selected** is
  `$accent-soft` for rows, or a solid `$accent` for chips and presets.
- **Disabled** is `opacity: 0.55` with `cursor: not-allowed` (`progress`
  while a command is in flight).
- **Errors** are `.field__error` (`$danger-text`) under the field, plus a toast
  through `notify.service.ts` for a failed command. Never signal an error with
  colour alone.

## Before you call a UI change done

- [ ] No component stylesheet, `styleUrl`, `:host` or `::ng-deep` was added;
  CSS went into the right `assets/styles/` partial, registered in `main.scss`.
- [ ] Every selector is a BEM class. No tags, ids, `:first-child`/`:has()`,
  or element-of-element names. The block name is unique app-wide.
- [ ] Only tokens and mixins; no literal colours, sizes or spacing.
- [ ] Sentence case; no new uppercase or tracking.
- [ ] All copy is in `en.json` (the `extract-static-text` skill).
- [ ] Looks right at 1024×640 (the window minimum) and 1440×900, and still
  reads as medium-toned.
- [ ] If you used a new token, checked it with `class="app-dark"` on `<html>`.
