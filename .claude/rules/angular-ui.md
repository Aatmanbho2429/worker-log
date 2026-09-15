---
paths:
  - "web/src/app/**/*.ts"
  - "web/src/app/**/*.html"
---

# Angular conventions

Standalone components with signals throughout — no `NgModule`s for
declarations, no `@Input()`/`@Output()` decorators where `input()`/`output()`
will do. PrimeNG 21 on the Aura preset.

## No component stylesheets

> Pending: `.claude/plans/theme-refresh.md` is removing the existing
> `styleUrl`s. Delete this line once it ships.

Components carry no CSS: no `styleUrl`, no `styles`, no `.scss` beside the
component, no `:host` or `::ng-deep`. Custom CSS goes in a BEM partial under
`web/src/assets/styles/` (`components/`, `shared/` or `views/`), registered in
`main.scss`. A host element that needs styling gets `host: { class: '…' }` in
its decorator. `angular.json` generates components with `"style": "none"`.
File layout and BEM rules are in `.claude/rules/ui-design-system.md`.

## One PrimeNG import, not a dozen

`web/src/app/shared/primeng-components-module.ts` bundles the PrimeNG surface
this app actually uses into a single `NgModule`, with `CommonModule`,
`FormsModule`, `RouterModule` and `TranslateModule` riding along. Every view
and both shared components import that one symbol. **Add to it** rather than
importing a PrimeNG module directly into a view.

## Copy never lives in a template

All user-facing text comes from `web/src/assets/i18n/en.json`, namespaced by
view folder (`waste.*`, `grades.*`, …) plus shared `common.*` /
`validation.*`; resolved with the `translate` pipe in templates and
`TranslateService.instant()` in components. Repeated non-text literals go to
`models/constants.ts`. The `extract-static-text` skill is the procedure and
carries the destination table.

## Shared screen state

Every screen shares one date range (defaulting to the current month) and an
optional series filter. That state lives above the view level in
`layout/shell/` — the chrome every signed-in screen renders inside — not
per-screen. Helpers: `core/date-range.ts`, `shared/range-filter`.

## Routing

`app.routes.ts` mounts every view as a lazy `loadComponent` child of `Shell`
behind `canActivateChild: [authGuard]`. `login` and `register` sit *outside*
the shell behind `guestGuard`, because there is nothing to navigate to until
somebody is signed in.

## One service per entity

`web/src/app/services/` holds a Tauri-calling service per entity, each
injecting `ZoneWrapperService`: `series/`, `reason/`, `grade/`, `worker/`,
`waste/` (dashboard, log entries, waste exports), `barcode/` (the scanning
sheet, recording a scan), `settings/` (app info, demo-data seeding), and
`export/` (the save-dialog + open-after-export flow shared by the month sheet
and reports, built on top of `WasteService`). The account layer is the one
deliberate exception and lives in `core/` — see the `supabase` skill for why.
