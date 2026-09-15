# Plan: controls refresh — inputs and buttons

Written 2026-09-15 for an implementer picking this up cold. Delete this file
when it ships (Phase 6).

Builds on the theme refresh (commit `bef2fdb`, branch `theme-refresh`, not yet
merged). The spec for everything not restated here is
`.claude/rules/theming.md` and `.claude/rules/ui-design-system.md`; if this plan
and a rule disagree, the rule wins, except where Phase 6 says to change the rule.

## Goal

Inputs and buttons that look deliberate and match each other:

- **Sizes:** `$control-h-sm` 32 / `$control-h` 40 / `$control-h-lg` 48 px,
  exactly as the rules say, with readable 16px text and 16px icons.
- **States you can see:** hover, focus, invalid and disabled.
- **A clear button hierarchy:** primary / secondary / text / danger.
- **One family:** the hand-rolled controls (scan box, range presets, the
  scanning page's tools) look like the PrimeNG ones sitting next to them.

## What is wrong today (the why)

Measured on 2026-09-15 in the Browser pane, `/login` and `/register` at
1440×900, by injecting PrimeNG-classed elements:

| Control | Measured | Should be |
| --- | --- | --- |
| default `pInputText` | 30px tall, **10px** text | 40px, 16px |
| every `p-button` at default size | 30px, **10px** label, **10px** icon | 40px, 16px, 16px icon |
| icon-only row action (pencil/trash) | 25×30px | 32×32px (`size="small"`) |
| auth submit next to large inputs | 30px beside 44px inputs | 48px beside 48px |
| password eye icon | 10px | 16px |
| `severity="secondary" [outlined]="true"` | text `#7c8491` on transparent, border `#e3e6eb`; 3.8:1, reads as disabled | dark grey text on white, visible border |
| input text colour | `#3f4753` (Aura's `surface.700`) | `$text-primary` `#262c35` |
| field with an error | red message under a **grey** border | red border as well |
| `+91` input-group addon | 5px padding, faint | 40px min width, tinted |

**Root cause:** `base/_reset.scss` sets `html { font-size: 62.5% }`, so
1rem = 10px.

- PrimeNG's Aura preset is written for a 16px root. Every size in it is rem:
  - `iconSize` 1rem
  - form-field padding
  - `iconOnlyWidth` 2.5rem
  - paginator buttons, select options, date-picker cells, tags, toasts
- `inputtext`, `button`, `select` and `datepicker` also **hard-code**
  `font-size: 1rem` in their component CSS; there is no token for it.
- So the whole PrimeNG surface renders at 62.5%, not just inputs and buttons.
- The theme refresh happened to compensate in a few tokens (large form fields,
  dialog padding). That is why the auth inputs look fine and everything else
  doesn't.

## Decision: go back to a 16px root

- Delete the 62.5% rule. 1rem = 16px, which is what Aura expects, so every
  PrimeNG internal is right at once — including the ones with no token.
- **The app's own sizes keep their exact pixel values.**
  - Add a `to-rem($px)` function to `_tokens.scss`.
  - Convert every rem literal in the app's SCSS, `theme.ts` and templates.
  - After Phase 1 nothing in the app changes size except PrimeNG.
- **Rejected:** keeping the 10px root and overriding PrimeNG sizes token by
  token.
  - That is dozens of tokens across ~15 components.
  - The four hard-coded font sizes would need global `.p-*` CSS, which
    `ui-design-system.md` forbids.
  - It silently breaks again on every PrimeNG upgrade.
- **Named `to-rem`, not `rem`:** `rem()` is already a CSS/Sass math function
  (remainder).
- **Text inside controls is 16px** (PrimeNG's size, not tokenisable) while
  body text stays 15px. That is deliberate: legible at arm's length, and no
  fight with PrimeNG. Phase 6 records it in the rules as `$fs-control`.

## Non-goals

- **Domain controls keep their own look:** the waste screen's grade counters
  (`−` / `+`), reason chips, barcode tiles, shell nav links. Only their sizes
  pass through the rem conversion, unchanged in pixels.
- **No behaviour, copy or routing changes.** No new components.
- **No change to `core/scan.service.ts`** (see Phase 4, step 3).
- **No Rust changes.**

---

## Phase 0 — setup

1. From the repo root: `git checkout theme-refresh && git checkout -b controls-refresh`.
2. `npm run web:build`. It is clean today; note any warnings as the baseline.
3. `npm run web:start` in the background, open `http://localhost:4200/login`
   in the Browser pane, and run the Phase 5 probe script. Keep the numbers and
   a screenshot of `/login` and `/register` as the "before".

## Phase 1 — 16px root, app sizes unchanged

1. **`web/src/assets/styles/base/_tokens.scss`**
   - Very first line (Sass requires `@use` before anything else):
     `@use 'sass:math';`
   - Replace the comment `// 1rem == 10px (see _reset.scss), so every value
     reads in whole pixels.` with:

     ```scss
     // 1rem == 16px, the browser default, which PrimeNG's Aura preset is written
     // for. Write every size in pixels through `to-rem()` so values still read
     // in whole pixels. Never set a root font-size.
     @function to-rem($px) {
       @return math.div($px, 16) * 1rem;
     }
     ```

   - Convert every rem token. The rule is **old rem × 10 = px →
     `to-rem(px)`**. For example:
     - `$fs-xs: 1.2rem` → `to-rem(12)`
     - `$space-2xs: 0.2rem` → `to-rem(2)`
     - `$shell-sidebar-width: 24rem` → `to-rem(240)`
     - `$control-h-lg: 4.8rem` → `to-rem(48)`
     - the `focus-ring` mixin's `0.3rem` → `to-rem(3)`
   - `$radius-pill: 9999px`, the `em` letter-spacings and unitless line heights
     stay as they are.
2. **`base/_reset.scss`**
   - Delete the `html { font-size: 62.5%; }` rule and its comment.
   - Convert the scrollbar `1rem` → `to-rem(10)` and the `0.2rem` values
     (scrollbar border, focus outline width and offset) → `to-rem(2)`.
3. **`base/_theme.scss`** has four rem values inside CSS custom properties
   (the shadows). **Sass does not evaluate functions inside a custom property
   value unless interpolated**, so write `#{to-rem(1)}`, not `to-rem(1)`.
   For example, `--shadow-card: 0 #{to-rem(1)} #{to-rem(2)} #{rgba($gray-800, 0.06)};`.
4. **Every other partial:** each `N rem` literal → `to-rem(N×10)`. Counts on
   2026-09-15:

   | Partial | rem literals |
   | --- | --- |
   | `views/_barcodes.scss` | 20 |
   | `components/_shell.scss` | 8 |
   | `views/_profile.scss` | 7 |
   | `views/_month-sheet.scss` | 6 |
   | `views/_reports.scss` | 5 |
   | `components/_auth-card.scss`, `components/_primeng.scss` | 4 each |
   | `components/_auth-brand.scss`, `views/_waste.scss` | 3 each |
   | `shared/_scan-field.scss`, `components/_kpi.scss`, `components/_data-table.scss`, `views/_grades.scss` | 2 each |
   | `components/_auth-layout.scss`, `components/_card.scss`, `components/_password-meter.scss`, `views/_settings.scss`, `views/_reasons.scss` | 1 each |

   Take care with:
   - `views/_barcodes.scss`
     - `.barcode-tile__code` `0.85rem` → `to-rem(8.5)`; `.barcode-tile__count`
       `1rem` → `to-rem(10)`. The tile is scanner geometry: pixel-identical
       or nothing.
     - The `$col-sr`, `$col-worker`, `$col-series`, `$col-cell` and
       `$head-group` variables. The `calc()` and `scroll-margin-left` that use
       them need no other change.
   - `components/_primeng.scss`: the OTP `5.6rem` / `4.8rem` and the range
     filter's `14rem` / `16rem`.
5. **`web/src/app/theme.ts`.** Every rem value set in the theme refresh assumed
   the 10px root. Phases 2 and 3 rewrite `formField` and `components.button`,
   so convert only these now (both colour schemes where the key appears in
   both). `px` values stay.

   | Token | Now | Becomes |
   | --- | --- | --- |
   | `datatable` `headerCell.padding` | `'1rem 1.6rem'` | `'0.625rem 1rem'` |
   | `datatable` `bodyCell.padding` | `'1.2rem 1.6rem'` | `'0.75rem 1rem'` |
   | `dialog` `header.padding` | `'2rem 2.4rem 1.2rem'` | `'1.25rem 1.5rem 0.75rem'` |
   | `dialog` `title.fontSize` | `'1.8rem'` | `'1.125rem'` |
   | `dialog` `content.padding` | `'0 2.4rem 2rem'` | `'0 1.5rem 1.25rem'` |
   | `dialog` `footer.padding` | `'0 2.4rem 2rem'` | `'0 1.5rem 1.25rem'` |
   | `dialog` `footer.gap` | `'0.8rem'` | `'0.5rem'` |
   | `tooltip` `root.padding` | `'0.6rem 1rem'` | `'0.375rem 0.625rem'` |
   | `tag` `root.fontSize` | `'1.2rem'` | `'0.75rem'` |
   | `tag` `root.padding` | `'0.2rem 0.8rem'` | `'0.125rem 0.5rem'` |
   | `tabs` `tab.padding` | `'1.2rem 1.6rem'` | `'0.75rem 1rem'` |

6. **Templates and TypeScript** (complete on 2026-09-15; re-grep
   `rem['"]` under `web/src/app` to be sure):

   | Where | Now | Becomes |
   | --- | --- | --- |
   | `models/constants.ts` `DIALOG_WIDTH.confirm`, `.form` | `'40rem'` | `'25rem'` |
   | `DIALOG_WIDTH.formWide` | `'52rem'` | `'32.5rem'` |
   | `DIALOG_WIDTH.account` | `'44rem'` | `'27.5rem'` |
   | `p-skeleton height` in `series.html`, `grades.html`, `workers.html`, `reasons.html`, `profile.html` (payments) | `3.6rem` | `2.25rem` |
   | `waste.html` `p-skeleton height` | `5.6rem` | `3.5rem` |
   | `sheet.html` `p-skeleton height` | `3.2rem` | `2rem` |
   | `profile.html` plans `p-skeleton height` | `19rem` | `11.875rem` |
   | `profile.html` plans dialog `maxWidth` | `78rem` | `48.75rem` |
   | `reports.html` `scrollHeight` | `34rem` | `21.25rem` |

**Checkpoint:**
- `npm run web:build` passes.
- `grep -rnE '[0-9]rem' web/src/assets/styles` matches only the `1rem` inside
  `to-rem()`.
- `grep -rn '62.5' web/src` matches nothing.
- In the Browser pane, `/login` and `/register` look the same as the "before"
  screenshots **except** the PrimeNG controls, which grow. Run the probe
  script: PrimeNG inputs and buttons should now read 16px text.

## Phase 2 — form fields

**Do not guess token paths.** Before writing, open the matching interfaces in
`web/node_modules/@primeuix/themes/types/` (`index.d.ts` for `formField`;
`inputgroup/`, `datepicker/`, `inputotp/`, `select/`) and use only keys that
exist. The TypeScript build rejects unknown keys, as it did for `tabs` in the
theme refresh.

### 2a. `web/src/app/theme.ts`

1. **`semantic.formField`:** replace the block. Heights assume 16px text; the
   paddings are starting points, and Phase 5's probe decides (±1px is fine).

   ```ts
   formField: {
     paddingX: '0.75rem', // 12px
     paddingY: '0.5625rem', // 9px  → ~40px
     borderRadius: '6px',
     sm: { fontSize: '0.875rem', paddingX: '0.625rem', paddingY: '0.375rem' }, // ~32px
     lg: { fontSize: '1rem', paddingX: '0.875rem', paddingY: '0.8125rem' }, // ~48px
   },
   ```

2. **Focus halo.**
   - Aura's fields have no focus ring, only a border-colour change. Target: a
     `{blue.600}` border plus `box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18)`,
     the same halo the `focus-ring` mixin draws on the scan box.
   - Read `web/node_modules/@primeuix/styles/dist/inputtext/index.mjs` to see
     which token the `:focus` / `:focus-visible` rule uses (`focus.ring.shadow`
     or `form.field.focus.ring.*`), and set that one inside `formField`.
   - Check the result on `select` and `password` too (`dist/select`,
     `dist/password`).
   - In dark, use `rgba(96, 165, 250, 0.3)`.
3. **`semantic.colorScheme.light.formField`** (new):
   - background `{gray.0}`, disabledBackground `{gray.100}`, filledBackground `{gray.50}`
   - borderColor `{gray.300}`, hoverBorderColor `{gray.400}`,
     focusBorderColor `{blue.600}`, invalidBorderColor `{red.600}`
   - color `{gray.800}`, disabledColor `{gray.500}`
   - placeholderColor `{gray.500}`, invalidPlaceholderColor `{gray.500}` (the
     border and the message carry the error; a red placeholder just shouts)
   - iconColor `{gray.500}`, shadow `'none'`
4. **`semantic.colorScheme.dark.formField`** (new):
   - background `{gray.900}`, disabledBackground `{gray.750}`, filledBackground `{gray.850}`
   - borderColor `{gray.700}`, hoverBorderColor `{gray.600}`,
     focusBorderColor `{blue.400}`, invalidBorderColor `{red.400}`
   - color `{gray.50}`, disabledColor `{gray.500}`
   - placeholderColor `{gray.400}`, invalidPlaceholderColor `{gray.400}`
   - iconColor `{gray.400}`, shadow `'none'`
5. **`components.inputgroup`:** addon padding `'0.5rem 0.75rem'`, minWidth
   `'2.5rem'`.
   - Colours are per scheme if the type says so: light background `{gray.50}`
     and color `{gray.600}`; dark background `{gray.800}` and color
     `{gray.400}`.
   - Border colour follows the form field; leave it unset.
6. **`components.datepicker`** — the calendar button `showIcon` attaches to the
   input:
   - dropdown width `'2.5rem'`
   - light: background `{gray.50}`, hoverBackground `{gray.100}`,
     activeBackground `{gray.200}`, borderColor `{gray.300}`,
     hoverBorderColor `{gray.400}`, color `{gray.600}`, hoverColor `{gray.800}`
   - dark: background `{gray.800}`, hoverBackground `{gray.750}`,
     activeBackground `{gray.700}`, borderColor `{gray.700}`,
     hoverBorderColor `{gray.600}`, color `{gray.400}`, hoverColor `{gray.50}`
7. **`components.inputotp`:** `input.lg.width` `'3rem'`.

### 2b. Templates and `_primeng.scss`

PrimeNG 21 facts, checked in `web/node_modules/primeng/types/`:
- `Password`, `Select`, `DatePicker` and `InputOtp` extend `BaseInput`, so
  they take `size`, `fluid` and `invalid`.
- The `pInputText` directive takes `pSize`, `fluid` and `invalid`.
- The comment in `_primeng.scss` saying `p-password` takes no size is stale.

1. **Password width hack.** Add `[fluid]="true"` to all six `<p-password>`
   (login 1, register 2, profile 3) and delete their
   `styleClass="field__password"`. Delete the `.field__password` rule from
   `_primeng.scss`.
2. **Large password hack.** On the three auth `<p-password>` (login, register ×2),
   replace `inputStyleClass="field__input field__input--lg"` with
   `size="large"`. Delete the `input.field__input--lg` rule and its comment from
   `_primeng.scss`. `pSize="large"` on the auth `pInputText`s stays.
3. **Worker dialog select.** Add `[fluid]="true"` to the series `<p-select>` in
   `workers.html`'s dialog, so it fills the field like the text inputs beside
   it. The toolbar filter and range-filter selects keep their widths.
4. **Invalid state.** Bind `[invalid]` on every control to the same condition
   that shows its `.field__error`:

   | Template | Control → condition |
   | --- | --- |
   | `login.html` | `#login-email` → `!!emailError()`; password → `!!passwordError()`; `#forgot-email` → `!!forgotError()`; forgot `p-inputotp` → `!!forgotCodeError()` |
   | `register.html` | each input/password → `!!problem('<field>')` (firstName, lastName, phone — on the `input` inside `p-inputgroup` — email, companyName, password, confirmPassword); `p-inputotp` → `!!otpFieldProblem()` |
   | `profile.html` | current / new / confirm password → `!!currentError()` / `!!newError()` / `!!confirmError()` |
   | `reasons.html`, `grades.html`, `series.html` | name input → `nameInvalid()` |
   | `workers.html` | first → `firstNameInvalid()`, last → `lastNameInvalid()`, series select → `seriesInvalid()` |

**Checkpoint:** build passes. On `/register`, press **Create account** with an
empty form: every field gets a red border as well as its message.

## Phase 3 — buttons

### The hierarchy (Phase 6 copies this into `ui-design-system.md`)

| Variant | Template | Look | Use |
| --- | --- | --- | --- |
| Primary | `<p-button>` | solid `blue.600`, white text | **one per region**: the page's main action, a dialog's confirm, the auth submit |
| Secondary | `severity="secondary"` | white fill, `gray.300` border, `gray.700` text | every other visible action: Refresh, CSV, PDF on the scanning page, Reset password, View plans, dialog **Cancel** |
| Text | `severity="secondary" [text]="true"` | no fill, `gray.600` text, `gray.100` hover | icon-only row actions, sign out, dismiss |
| Danger | `severity="danger"` (add `[text]="true"` for a row's delete icon) | solid `red.600` / red text | destructive confirms, row delete |

Sizes: `size="small"` 32px for row actions and inline dismisses; default 40px;
`size="large"` 48px for the auth submits and the scan box's Record button.

### 3a. `components.button` in `theme.ts`

Check every key against `web/node_modules/@primeuix/themes/types/button/index.d.ts`
(`ButtonTokenSections`) and drop any that do not exist.

1. **`root`** (replace):

   ```ts
   root: {
     borderRadius: '6px',
     gap: '0.5rem',
     paddingX: '1rem',
     paddingY: '0.5625rem', // ~40px
     iconOnlyWidth: '2.5rem',
     label: { fontWeight: '500' },
     sm: { fontSize: '0.875rem', paddingX: '0.75rem', paddingY: '0.375rem', iconOnlyWidth: '2rem' },
     lg: { fontSize: '1rem', paddingX: '1.25rem', paddingY: '0.8125rem', iconOnlyWidth: '3rem' },
   },
   ```

2. **`colorScheme.light`**
   - `root.primary`: unchanged.
   - `root.secondary`:
     - background `{gray.0}`, hoverBackground `{gray.50}`, activeBackground `{gray.100}`
     - borderColor `{gray.300}`, hoverBorderColor `{gray.400}`, activeBorderColor `{gray.400}`
     - color `{gray.700}`, hoverColor `{gray.800}`, activeColor `{gray.800}`
     - focusRing color `{blue.500}`
   - `root.danger`:
     - background `{red.600}`, hoverBackground `{red.700}`, activeBackground `{red.800}`
     - matching border colours
     - color / hoverColor / activeColor `'#ffffff'`
     - focusRing color `{red.500}`
   - `outlined.secondary`: hoverBackground `{gray.50}`, activeBackground
     `{gray.100}`, borderColor `{gray.300}`, color `{gray.700}`. This is a
     safety net; the templates stop using outlined secondary.
   - `text.secondary` and `text.danger`: unchanged.
3. **`colorScheme.dark`**
   - `root.primary`: unchanged.
   - `root.secondary`:
     - background `{gray.800}`, hoverBackground `{gray.750}`, activeBackground `{gray.700}`
     - borderColor `{gray.700}`, hoverBorderColor `{gray.600}`, activeBorderColor `{gray.600}`
     - color `{gray.200}`, hoverColor `{gray.50}`, activeColor `{gray.50}`
     - focusRing color `{blue.400}`
   - `root.danger`: same as light.
   - `outlined.secondary`: hoverBackground `{gray.750}`, activeBackground
     `{gray.700}`, borderColor `{gray.700}`, color `{gray.200}`.
   - `text.*`: unchanged.
4. **`semantic.disabledOpacity`** `'0.55'`, the rules' value; Aura ships `0.6`.
   Only if the type accepts the key; otherwise skip it.

### 3b. Templates

1. **Remove `[outlined]="true"`** from the six secondary buttons: `waste.html`
   Refresh, `reports.html` CSV, `sheet.html` CSV, `barcodes.html` PDF,
   `profile.html` Reset password and View plans. They keep
   `severity="secondary"`.
   - Leave the plan cards' bound `[outlined]="plan.id !== bestPlanId()"`
     alone: it is an outlined **primary** and stays blue.
2. **Dialog Cancel buttons:** drop `[text]="true"` and keep
   `severity="secondary"`. That is seven buttons:
   - `reasons.html`, `grades.html`, `series.html`, `workers.html`
   - `profile.html` change password
   - `login.html` forgot-password email step and code step
3. **Confirm dialogs:** `grep -rn rejectButtonStyleClass web/src/app` and
   change every `'p-button-text'` to `'p-button-secondary'`. The accept
   buttons keep `'p-button-danger'`.
4. **Row actions:** add `size="small"` to every pencil and trash button in
   `reasons.html`, `grades.html`, `series.html` and `workers.html`, plus the
   reorder chevrons in `reasons.html` (10 buttons). In `_data-table.scss`,
   `.data-table__actions` gap becomes `$space-xs`.
5. **Auth:** add `size="large"` to the submit/CTA `p-button`s:
   - `login.html` Sign in
   - `register.html` Create account, code submit, and success CTA

   The forgot-password dialog's footer buttons stay default.
6. **`shared/scan-field/scan-field.html`:** add `size="large"` to Record. It
   sits beside the 48px scan input.
7. **`barcodes.html`:** add `size="small"` to the status panel's Dismiss button.
8. **`layout/shell/shell.html`:** the sign-out button stays (text, rounded,
   default size).

**Checkpoint:** build passes; `grep -rn '\[outlined\]="true"' web/src/app` and
`grep -rn "p-button-text" web/src/app` both match nothing.

## Phase 4 — hand-rolled controls match PrimeNG

1. **`base/_tokens.scss`:** add after `$fs-2xl`:
   `$fs-control: to-rem(16); // text inside inputs, selects, buttons and presets — PrimeNG's own size`.
2. **`shared/_scan-field.scss` `.scan-field__input`:**
   - Border `1px solid $border-default` (was `$border-strong`).
   - Add `&:hover:not(:disabled) { border-color: $border-strong; }`.
   - Focus stays `$accent` border plus `@include focus-ring`.
   - Placeholder font size → `$fs-control`.
3. **`views/_barcodes.scss` and `barcodes.html` — the scanning page's tools**
   - **Search → PrimeNG.**
     - Replace the native `<input type="search" class="scan-page__search">`
       with
       `<p-iconfield class="scan-page__search"><p-inputicon class="pi pi-search" /><input pInputText type="search" …same bindings… /></p-iconfield>`.
     - It is still an `HTMLInputElement`, so `isEditable()` in
       `core/scan.service.ts` still ignores keystrokes typed into it.
     - Replace the `.scan-page__search` rules with
       `.scan-page__search { width: to-rem(200); }`. That is a plain class on
       the `p-iconfield` host, not a `.p-*` selector.
   - **Series select → keep it native, restyle it.**
     - PrimeNG's Select focuses a `<span role="combobox">`, which
       `isEditable()` does not treat as editable. Keystrokes on it would be
       read as a scan, and changing `ScanService` is out of scope.
     - Wrap it:
       `<span class="scan-page__select-wrap"><select class="scan-page__select">…</select><i class="scan-page__select-icon pi pi-chevron-down"></i></span>`.
     - `.scan-page__select-wrap`: `position: relative; display: inline-flex;`
     - `.scan-page__select`:
       - `appearance: none`, `cursor: pointer`
       - width `to-rem(180)`, height `$control-h`, padding
         `0 to-rem(36) 0 $space-md`, font-size `$fs-control`
       - colour `$text-primary`, background `$surface-card`
       - `1px solid $border-default`, `$radius-md`
       - hover border `$border-strong`
       - `&:focus { border-color: $accent; @include focus-ring; }`
     - `.scan-page__select-icon`: `position: absolute; right: $space-md;
       top: 50%; transform: translateY(-50%); pointer-events: none;` colour
       `$text-muted`, font-size `$icon-sm`.
4. **`shared/_range-filter.scss` `.range-filter__preset`:**
   - font-size `$fs-control` (was `$fs-sm`); weight stays medium.
   - On `&:hover:not(:disabled)`, also set `border-color: $border-strong`.
   - Add `&:focus-visible { position: relative; z-index: 1; }` so the global
     focus outline is not hidden under the overlapping neighbour.
5. **`components/_primeng.scss`, what remains:**
   - the data-table index/meta colour rules
   - the OTP digits: drop `width` (the `inputotp.input.lg.width` token now
     gives 48px); keep `height: to-rem(56)`, `$fs-xl`, semibold, `$radius-md`,
     centred, and the `display: flex !important` rule
   - the range-filter input/select widths

   Re-read the header comment and every per-rule comment; keep each accurate.

**Checkpoint:** build passes.

## Phase 5 — verify

1. `npm run web:build` from the root: no errors, no warnings over the Phase 0
   baseline.
2. `cd web && npm test -- --watch=false`: the four spec files pass. The
   scan-field spec queries by tag, so the Record button's `size` does not
   affect it.
3. **Grep gates** (under `web/src`):

   | Check | Expected |
   | --- | --- |
   | `[0-9]rem` in `assets/styles` | only `1rem` inside `to-rem()` |
   | `62.5` | none |
   | `field__input--lg\|field__password` | none |
   | `\[outlined\]="true"` in `app/**/*.html` | none |
   | `p-button-text` in `app` | none |
   | `\[text\]="true"` in `app/**/*.html` | exactly 11 (10 row actions + sign out) |
   | `size="small"` in `app/**/*.html` | exactly 11 (10 row actions + Dismiss) |
   | per template, count of `field__error` vs `[invalid]` | equal (register's phone error sits on the input inside `p-inputgroup`) |
   | `\.p-[a-z]` and `!important` in `assets/styles` | only `components/_primeng.scss` (unchanged gate from the theme refresh) |
   | `styleUrl\|:host\|::ng-deep` in `app` | none (unchanged gate) |

4. **Probe.**
   - Paste into the Browser pane's JavaScript tool on `/login` or `/register`.
     Button and input styles are loaded there.
   - Every line must be within ±1px of its target.
   - If a height is off, adjust that size's `paddingY` in `theme.ts` by
     `0.0625rem` (1px) and re-run.

   ```js
   // Measures PrimeNG controls against the control-height rules, then removes itself.
   const host = document.createElement('div');
   host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff;padding:8px;display:flex;gap:8px;flex-wrap:wrap;width:900px';
   host.innerHTML = `
     <input class="p-inputtext p-component" data-t="input 40" />
     <input class="p-inputtext p-component p-inputtext-sm" data-t="input-sm 32" />
     <input class="p-inputtext p-component p-inputtext-lg" data-t="input-lg 48" />
     <button class="p-button p-component" data-t="button 40"><span class="p-button-icon p-button-icon-left pi pi-check"></span><span class="p-button-label">Save</span></button>
     <button class="p-button p-component p-button-lg" data-t="button-lg 48"><span class="p-button-label">Sign in</span></button>
     <button class="p-button p-component p-button-secondary" data-t="secondary 40"><span class="p-button-label">Cancel</span></button>
     <button class="p-button p-component p-button-secondary p-button-text p-button-icon-only p-button-sm" data-t="row-action 32x32"><span class="p-button-icon pi pi-pencil"></span></button>`;
   document.body.appendChild(host);
   await new Promise((r) => setTimeout(r, 200));
   const out = [...host.children].map((el) => {
     const s = getComputedStyle(el);
     const r = el.getBoundingClientRect();
     const icon = el.querySelector('.p-button-icon');
     return `${el.dataset.t}: ${r.width.toFixed(0)}x${r.height.toFixed(1)} font=${s.fontSize}` +
       ` color=${s.color} bg=${s.backgroundColor} border=${s.borderColor}` +
       (icon ? ` icon=${getComputedStyle(icon).fontSize}` : '');
   });
   host.remove();
   out.join('\n');
   ```

   Targets:
   - inputs and buttons 16px text; `input-sm` and `row-action` 14px
   - icons 16px
   - secondary colour `rgb(63, 71, 83)` on `rgb(255, 255, 255)` with border
     `rgb(208, 213, 221)`

5. **Contrast.**
   - Save as a scratch file (don't commit), run with `node`; every line must
     print `ok`.
   - If one fails, step the shade in `theme.ts` and record it in Phase 6.

   ```js
   // WCAG 2.x contrast for the new control colour pairs.
   const lum = (h) => {
     const [r, g, b] = h.match(/\w\w/g).map((c) => {
       const v = parseInt(c, 16) / 255;
       return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
     });
     return 0.2126 * r + 0.7152 * g + 0.0722 * b;
   };
   const ratio = (a, b) => {
     const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
     return (hi + 0.05) / (lo + 0.05);
   };
   // [label, foreground, background, minimum]
   const pairs = [
     ['L input text', '#262c35', '#ffffff', 7],
     ['L placeholder', '#7c8491', '#ffffff', 3],
     ['L secondary button', '#3f4753', '#ffffff', 4.5],
     ['L secondary button hover', '#262c35', '#f7f8fa', 4.5],
     ['L text button', '#58616d', '#ffffff', 4.5],
     ['L text button hover', '#58616d', '#f0f2f5', 4.5],
     ['L addon', '#58616d', '#f7f8fa', 4.5],
     ['white / danger', '#ffffff', '#dc2626', 4.5],
     ['D input text', '#f7f8fa', '#161a21', 7],
     ['D placeholder', '#a3abb6', '#161a21', 3],
     ['D secondary button', '#e3e6eb', '#262c35', 4.5],
     ['D addon', '#a3abb6', '#262c35', 4.5],
   ];
   for (const [label, fg, bg, min] of pairs) {
     const r = ratio(fg, bg);
     console.log(r >= min ? 'ok  ' : 'FAIL', r.toFixed(2), label);
   }
   ```

6. **Visual, outside Tauri.**
   - `npm run web:start` from the root, then `http://localhost:4200/login` and
     `/register` in the Browser pane. Only these render; IPC errors in the
     console are expected.
   - Screenshot at 1440×900 and 1024×640, then with `class="app-dark"` added
     to `<html>` via the JavaScript tool, then revert.
   - Check:
     - inputs and the submit are both 48px on the auth card
     - the password eye icon is 16px
     - the `+91` addon is tinted
     - an empty submit on `/register` shows red borders
     - Tab focus shows the blue halo on fields and the outline on buttons
7. **Visual, in Tauri.** Everything behind the shell. Hand this to the user:

   ```bash
   WORKER_LOG_DB="$TMPDIR/worker-log-controls.db" npm run dev
   ```

   Then Settings → Load demo data, and walk:

   - [ ] **Page headers:** Refresh / CSV are white bordered buttons; PDF solid
     blue; same 40px height.
   - [ ] **Filter row** (waste, month sheet, reports): presets, both date
     pickers with their calendar buttons, and the series select all 40px tall,
     same text size, borders the same grey.
   - [ ] **Scan box:** input and Record both 48px; scanning page's series
     select and search match each other and the PDF button.
   - [ ] **Masters:**
     - row pencil/trash are 32px squares with tooltips
     - Add opens a dialog with 40px fields, bordered Cancel and blue Save
     - saving an empty name shows a red border and the message
     - the worker dialog's series select fills its field
   - [ ] **Delete confirm:** bordered Cancel, red Delete.
   - [ ] **Profile:** Reset password dialog (fluid password fields, meter);
     plans dialog buttons.
   - [ ] **Previously shrunk PrimeNG pieces now readable:** date-picker popup,
     select dropdown options, table paginator, tags, toast, tooltips.
   - [ ] **Nothing else moved:** shell, KPI tiles, month sheet grid, barcode
     tiles look identical to before.
   - [ ] **Dim theme:** temporarily add `class="app-dark"` to `<html>` in
     `web/src/index.html`, quick pass, revert.

## Phase 6 — fold into the rules and ship

1. **`.claude/rules/ui-design-system.md`**
   - **Tokens, never literals:** add that sizes are written in pixels through
     `to-rem($px)`, 1rem = 16px (what PrimeNG expects), and no rule ever sets a
     root font size. Add `to-rem` beside the mixins list.
   - **Typography table:**
     - Body and table cells stay `$fs-base` 15px.
     - Add a row: "Text inside controls (inputs, selects, buttons, presets) |
       `$fs-control` 16px | regular; buttons medium | PrimeNG's own size".
     - Weight line → "400 body, 500 names/labels/nav/buttons, 600
       titles/values. No 700."
   - **Screen anatomy:** add a **Buttons** bullet with the Phase 3 hierarchy
     table and sizes. Note that `[outlined]` is not used for secondary actions
     and that dialog footers are secondary Cancel + primary confirm.
   - **Forms bullet:** every control with a `.field__error` binds `[invalid]`
     to the same condition. Use `[fluid]` rather than width CSS. Use
     `size="large"` on `p-password` / `p-inputotp` / `p-button` and
     `pSize="large"` on `pInputText`.
   - **Data tables bullet:** row actions are `size="small"` text icon buttons.
   - **Before you call a UI change done:** add "Controls measured at
     32/40/48px (the probe in git history, commit of this plan, is fine)".
2. **`.claude/rules/theming.md`** — Two palettes:
   - Field colours live in `theme.ts` `semantic.colorScheme.*.formField`
     (border `gray.300`, hover `gray.400`, focus `blue.600`, invalid
     `red.600`).
   - Button colours live in `components.button` (secondary is white with a
     `gray.300` border in light, `gray.800` in dark).
3. **`CLAUDE.md`:** delete the "In flight now: `controls-refresh.md` …"
   sentence under "Where the detail lives".
4. Delete this plan file.
5. Commit on `controls-refresh`.
