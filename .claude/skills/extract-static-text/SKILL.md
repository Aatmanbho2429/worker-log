---
name: extract-static-text
description: Move hardcoded user-facing copy out of Angular templates and TypeScript into `web/src/assets/i18n/en.json`, and repeated non-text literals (routes, command names, storage keys, limits, formats) into `web/src/app/models/constants.ts`. Use when asked to extract or externalise static text, i18n/translate a screen, remove magic strings, or pull constants out of components — e.g. "move the waste screen strings to en.json" or "no hardcoded text in the reports view".
argument-hint: [view, folder or file — defaults to the whole web/src/app tree]
---

# Externalise static text and constants: $ARGUMENTS

Target: `$ARGUMENTS` if given, otherwise sweep `web/src/app/` one view folder at a
time — never rewrite the whole tree in one pass.

The convention already exists in this repo and is written down in
`web/src/app/shared/primeng-components-module.ts`: *all user-facing copy comes
from `assets/i18n/en.json`, never from a template*. The auth, profile and shell
screens follow it; most of `views/` does not yet. This skill is the procedure for
bringing a screen in line.

## Where each literal goes

| Literal | Destination |
| --- | --- |
| Anything a person reads on screen — headings, labels, buttons, placeholders, hints, empty states, table headers, `aria-label`, `title`, `alt`, confirm dialog copy, toast text | `web/src/assets/i18n/en.json` |
| A string reused in more than one place that is *not* read by a person — route paths, Tauri command names, event names, storage keys, regex patterns, size/length limits, date formats, PrimeNG severity/tone maps, magic numbers | `web/src/app/models/constants.ts` |
| Error text that comes back from a rejected command | Nowhere — it is authored in Rust (`AppError`) and shown as-is. Only the *fallback* passed to `notify.fromCommand(...)` is an en.json key. |
| CSS class names, element ids, `track` expressions, `pi pi-*` icon names, test fixtures | Leave alone. |

Route `title:` strings in `app.routes.ts` are a known exception: the router sets
them before a translation file is loaded, so leave them hardcoded unless asked.

## Steps

1. **Inventory first, edit second.** Read the template and the component, and list
   every literal with the bucket it lands in. Do not start editing until the list
   is complete — a half-migrated screen is worse than an untouched one.

2. **Reuse before you add.** Read `web/src/assets/i18n/en.json` and check whether
   the copy already exists. `common.*` (`cancel`, `done`, `error`, `success`,
   `warn`, `info`, `brandName`), `validation.*`, `shell.*`, `auth.*`, `profile.*`
   and `subscriptionStatus.*` are live namespaces. Never add a second key holding
   the same value.

3. **Add keys under a namespace named after the view folder.** `views/waste/` →
   `"waste": { ... }`, `views/reports/` → `"reports": { ... }`. Nest one level
   deeper only where a view has real sub-areas (`auth.login.*`,
   `auth.register.*`). Keys are camelCase and describe the *role*, not the words:
   `title`, `subtitle`, `refresh`, `emptyGrades`, `emptyGradesBody`,
   `goToGrades`, `columnDate`. Keep the JSON valid and 2-space indented, and put
   a new namespace next to related ones rather than at the end.

4. **Interpolate instead of concatenating.** ngx-translate takes `{{ name }}`
   placeholders — `"welcome": "Welcome, {{ name }}."` — resolved with
   `translate.instant('auth.login.welcome', { name })`. A sentence split across
   two keys so code can glue a value between them is a bug; make it one key with
   a placeholder. Where singular and plural differ, use two keys (see
   `profile.daysLeft` / `profile.dayLeft`).

5. **Replace in the template with the pipe.**

   ```html
   <!-- before -->
   <h1 class="page__title">Waste log</h1>
   <p-button icon="pi pi-refresh" label="Refresh" (onClick)="reload()" />
   <nav class="reasons" aria-label="Waste reasons">

   <!-- after -->
   <h1 class="page__title">{{ 'waste.title' | translate }}</h1>
   <p-button icon="pi pi-refresh" [label]="'common.refresh' | translate" (onClick)="reload()" />
   <nav class="reasons" [attr.aria-label]="'waste.reasonsNav' | translate">
   ```

   A plain attribute (`label="..."`, `placeholder="..."`, `aria-label="..."`) has
   to become a binding — `[label]`, `[placeholder]`, `[attr.aria-label]` — for the
   pipe to run at all. Missing that is the most common breakage in this migration.

6. **Replace in TypeScript with `TranslateService`.**

   ```ts
   private readonly translate = inject(TranslateService);
   ...
   this.notify.success(this.translate.instant('waste.entryLogged'));
   this.notify.fromCommand(error, this.translate.instant('waste.loadFailed'));
   ```

   `instant` is the right call here — `en.json` loads once at start-up and there
   is no language switch. Confirm dialogs get their `message`, `header`,
   `acceptLabel` and `rejectLabel` the same way; `shell.ts`'s sign-out confirm is
   the reference.

7. **Wire the imports.** A standalone view that already imports
   `PrimengComponentsModule` has the `translate` pipe — that module re-exports
   `TranslateModule`. A component that does not (a small `shared/` piece, say)
   must add `TranslateModule` from `@ngx-translate/core` to its own `imports`.
   On the `.ts` side, `import { TranslateService } from '@ngx-translate/core'`.

8. **Constants go in `web/src/app/models/constants.ts`.** Create the file if it
   does not exist yet; it is plain TypeScript, no Angular imports. Group with a
   section comment per area, `SCREAMING_SNAKE_CASE` names, `as const` on object
   and array literals so the types stay narrow:

   ```ts
   // Routes the app navigates to in code, not just from a template.
   export const ROUTE_WASTE = '/waste';
   export const ROUTE_LOGIN = '/login';

   // Tauri command names — mirrors the handlers in src-tauri/src/commands.rs.
   export const CMD_LIST_WORKERS = 'list_workers';

   // Toast lifetimes in ms, by severity.
   export const TOAST_LIFE = { success: 2500, info: 3000, warn: 4000, error: 6000 } as const;
   ```

   Import it as `import { ROUTE_WASTE } from '../../models/constants';`. Do not
   re-export it from `models/index.ts` — that file holds the DTOs and is imported
   wholesale by nearly every view.

   Two sets of constants already live where they belong and must **not** be copied
   here: the `worker-log://data-changed` event name in `models/events.ts`, and the
   validation patterns in `models/auth.ts`. Leave them.


## Done means

- No literal sentence or display word left in the touched template or component,
  and every attribute carrying copy is a binding.
- Every new key resolves. A missing key renders as the key itself and the build
  stays green, so grep each new key back out of `en.json` — or open the screen —
  rather than trusting the compiler.
- No duplicated values in `en.json`, and no key added that `common.*` already
  covered.
- `constants.ts` holds only literals used in more than one place, or ones whose
  meaning is unclear inline. A single-use string that reads fine where it sits
  stays where it sits.
