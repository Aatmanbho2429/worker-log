# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A desktop replacement for the paper waste register kept on a ceramic sanitaryware
line: who lost a piece, where it was lost, and which grade it came off the line
as. Ships as a native app — Tauri 2 shell, Angular 21 UI, Rust core, one SQLite
file. No server to run, no browser, no network for the register itself (there
is a small Supabase-backed account/licensing layer — see below).


## Commands

Run from the repo root unless noted.

```bash
npm install       # once — installs the Tauri CLI
npm run setup     # once — installs the Angular app's dependencies (web/)

npm run dev       # starts the Angular dev server + Tauri window together
npm run build     # produces platform installers (must build on that platform)

npm run web:start # Angular dev server alone (web/, no Tauri window)
npm run web:build # Angular production build alone
```

Angular tests (from `web/`):

```bash
npm test                                              # ng test — the whole vitest suite
npm test -- --watch=false                             # one-shot run from an interactive shell
npm test -- --include src/app/core/scan.service.spec.ts   # one spec file (path is web/-relative)
npm test -- --filter "keyboard wedge"                 # tests whose name matches a regex
```

Tests run through Angular's `@angular/build:unit-test` builder (vitest under
jsdom, no `vitest.config.ts`). Calling `npx vitest` directly fails — the builder
is what initialises the TestBed, so always go through `npm test`.

`--watch` defaults to **true in a TTY**, so `npm test` typed at a prompt sits in
watch mode rather than exiting; pass `--watch=false` when you want a run that
returns. There are four spec files — `core/scan.service.spec.ts`,
`core/zone-wrapper/zone-wrapper.service.spec.ts`, `models/auth.spec.ts`,
`shared/scan-field/scan-field.spec.ts` (37 tests, green as of this writing).
Nothing under `views/` or `services/` is covered.

There is no linter configured. Formatting is Prettier 3 against `web/.prettierrc`
(100 columns, single quotes, `angular` parser for templates) — there is no
`format` script, so run `npx prettier --write <paths>` from `web/`.

Rust tests are plain `#[test]` functions inline in the modules under
`src-tauri/src/` (`barcode.rs`, `barcode_sheet.rs`, `db.rs`, `report.rs`,
`models/response/api_response.rs`):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Seeding/resetting demo data from a terminal (useful for dev, doesn't open a
window):

```bash
cargo run --manifest-path src-tauri/Cargo.toml -- seed          # empty register only
cargo run --manifest-path src-tauri/Cargo.toml -- seed --force  # clear and reseed
```

`WORKER_LOG_DB` overrides the SQLite file location for both the app and the
seeder — set it during dev to avoid touching a real register.

## Architecture

```
worker-log/
├── package.json     root — `npm run dev` / `npm run build`
├── src-tauri/        Rust: Tauri commands, SQLite, PDF writer, account/licence
└── web/               Angular 21 + PrimeNG 21 front end
```

There is a stray empty `supabase/` directory in the working tree, but **the
edge-function sources are no longer in git** — commit `e27bffd` deleted
`supabase/README.md`, `config.toml`, `migrations/0001_account_schema.sql` and
`functions/{register,login,forgot-password}/index.ts`, and nothing since
restored them, so `git checkout supabase` fails with "pathspec did not match".
`src-tauri/src/supabase.rs` still calls those three deployed functions by name.
To edit them, recover the tree first: `git checkout e27bffd^ -- supabase`.

`npm run dev` is `tauri dev`: `tauri.conf.json`'s `beforeDevCommand` starts the
Angular dev server on `:4200` and the Tauri window points at it. `npm run build`
runs `web`'s production build and bundles `web/dist/CeramicWasteLog/browser`.

### The two halves talk over Tauri IPC, not HTTP

Angular never calls `fetch`/HTTP for app data — the single `provideHttpClient()`
in `app.config.ts` exists only so `@ngx-translate` can load `assets/i18n/en.json`
through `core/custom-translate-loader.ts`. Entity services under
`web/src/app/services/` (see below) invoke Tauri commands defined in
`src-tauri/src/commands.rs` and `auth.rs` (README has a command table, but a
stale one — see "Where the older docs have drifted"),
and Rust pushes `worker-log://data-changed` events back with a scope (`waste`,
`workers`, `series`, `reasons`, `grades`, `everything`) that tells each screen
whether to reload — read via `core/data-changes.service.ts`.

`web/src/app/core/zone-wrapper/zone-wrapper.service.ts` (`ZoneWrapperService`)
is the only file allowed to touch `invoke`/`listen` directly — every other
service calls `zoneWrapper.invoke()` / `zoneWrapper.listen()`. Command and
event names are not string literals at the call site: they come from
`core/tauri/tauri-commands.const.ts` (`TAURI_COMMANDS`) and
`core/tauri/tauri-events.const.ts` (`TAURI_EVENTS`), one entry per
`#[tauri::command]` in `src-tauri/src/lib.rs`'s `generate_handler![]` list —
see `.claude/rules/tauri-ipc.md` for why and what that means for new code.

Every command answers with an `ApiResponse<T> { statusCode, message, data }`
envelope (`.claude/rules/api-response-format.md`) rather than rejecting the
`invoke` promise — `src-tauri/src/models/response/api_response.rs` on the Rust
side, built from `AppError::status_code()` (400/404/409/500, from
`src-tauri/src/error.rs`). `ZoneWrapperService.invoke()` is what turns that
back into the `Promise<T>` every caller already expects: a 2xx resolves with
`data`, anything else throws `{ kind, message }` (the inverse status→kind
mapping lives in `zone-wrapper.service.ts`) — so `notify.service.ts`'s
`fromCommand()` and every existing `catch` block never had to change. A Rust
command's real logic lives in a `<name>_impl` function returning the ordinary
`AppResult<T>` with `?`-based error handling; the `#[tauri::command]` wrapper
just calls it and converts with `.into()`.

#### Adding a command touches exactly three places

1. `commands.rs` (or `auth.rs`) — the `<name>_impl` + `#[tauri::command]` pair.
2. `src-tauri/src/lib.rs`'s `generate_handler![]` list. Miss this and the call
   rejects at runtime with no compile error.
3. `core/tauri/tauri-commands.const.ts` — one `TAURI_COMMANDS` entry, so a typo
   is a compile error rather than a rejected promise.

It does **not** touch `src-tauri/capabilities/default.json`, despite what
`.claude/rules/tauri-ipc.md`'s last bullet and `scaffold-entity` step 8 say.
That file carries plugin permissions only (`dialog:allow-save`,
`opener:allow-open-path`, `log:default`, `core:*`); all 37 app commands are
reachable today with none of them listed, so an entry there would be
meaningless text. Verify with `cat src-tauri/capabilities/default.json` before
believing the rule — it is the rule that is wrong, not the code.

### Rust side (`src-tauri/src`)

- `commands.rs` — the `#[tauri::command]` entry points the front end calls for
  everything except auth (series/reason/grade/worker CRUD, waste dashboard/log,
  exports, barcode sheet/scan, seeding).
- `models/` — every struct/enum that crosses the Tauri bridge, split by
  direction per `.claude/rules/models.md`: `models/request/` (`SeriesUpsert`,
  `RangeQuery`, `RegisterRequest`, …) and `models/response/` (`Grade`,
  `Dashboard`, `UserAccount`, `BarcodeSheet`, …), one struct per file,
  `#[serde(rename_all = "camelCase")]` throughout. `models/mod.rs` re-exports
  both flatly, so the rest of the crate still writes `crate::models::Grade`.
  Kept field-for-field with the TS side in `web/src/app/models/`.
- `repo/` — one module per entity (`workers.rs`, `series.rs`, `reasons.rs`,
  `grades.rs`, `logs.rs`, `barcodes.rs`) holding the SQL for that table.
- `db.rs` — connection setup; migrations run from `src-tauri/migrations/`,
  tracked by `PRAGMA user_version`, each file idempotent and its own transaction.
- `barcode.rs` / `barcode_sheet.rs` — Code 128 encoding and the printed
  scanning-sheet layout; both have real symbology-correctness tests, not just
  smoke tests — see README's "The payload" section before touching either.
- `pdf.rs` — the self-contained PDF writer (base-14 Helvetica, no bundled
  fonts). Latin-only: names typed in a non-Latin script render as `?` — CSV
  export is the escape hatch (`report.rs` / `commands::export_waste_csv`).
- `state.rs` — `AppState` (the guarded single SQLite connection) and the app
  data directory resolution.
- `error.rs` — `AppError` and its `status_code()`, the mapping every command
  converts through on its way into an `ApiResponse` (see above).
- `auth.rs` + `supabase.rs` — the account/licence layer, separate from the
  waste-log data model entirely (see below). `auth.rs` holds the seven
  `auth_*` commands in the same `<name>_impl` + thin wrapper shape as
  `commands.rs`.

### Angular side (`web/src/app`)

Standalone components with signals, PrimeNG 21 Aura preset. Structure:

- `core/` — cross-cutting services with no UI, none of them entity-specific:
  `zone-wrapper/zone-wrapper.service.ts` (the only IPC boundary — see above),
  `tauri/` (the command/event name registries), `data-changes.service.ts` (the
  one `worker-log://data-changed` stream every entity service's consumers
  subscribe to), `auth.service.ts` + `auth.backend.ts`/`tauri-auth.backend.ts`
  (account/session — kept here rather than under `services/` because the
  account layer is already its own well-documented mini-layer, see below),
  `scan.service.ts` (keyboard-wedge barcode scan detection), `notify.service.ts`,
  `date-range.ts`, `grade-tone.ts`, `auth.guard.ts`.
- `services/` — one Tauri-calling service per entity, each injecting
  `ZoneWrapperService` and never `invoke`/`listen` directly
  (`.claude/rules/zone-wrapper.md`): `series/`, `reason/`, `grade/`, `worker/`,
  `waste/` (dashboard, log entries, waste exports), `barcode/` (the scanning
  sheet, recording a scan), `settings/` (app info, demo-data seeding),
  `export/` (the save-dialog + open-after-export flow shared by the month
  sheet and reports, on top of `WasteService`).
- `layout/shell/` — the chrome (nav, shared date range/series filter) every
  signed-in screen renders inside. `app.routes.ts` mounts every view as a lazy
  child of `Shell` behind `canActivateChild: [authGuard]`; `login` and
  `register` sit *outside* it behind `guestGuard`, because there is nothing to
  navigate to until somebody is signed in.
- `views/` — one folder per screen (`waste`, `sheet`, `reports`, `barcodes`,
  `workers`, `series`, `reasons`, `grades`, `settings`, `auth/login`,
  `auth/register`, `profile`), each `loadComponent`-ed from `app.routes.ts`.
- `shared/` — reusable pieces (`scan-field`, `range-filter`) used across views.
- `models/` — DTOs shared with Rust, split by direction per
  `.claude/rules/models.md`: `models/request/` (payloads, `RangeFilter`,
  `RegisterRequest`, …) and `models/response/` (`Grade`, `Dashboard`,
  `UserAccount`, …), one type per file, both re-exported flatly through
  `models/index.ts` so the rest of the app keeps writing
  `import { Grade } from '../../models'`. Note the two trees pair up
  one-for-one but do **not** always share a name: the account domain follows
  `.claude/rules/models.md`'s `*Request` suffix (`loginRequest.ts` ↔
  `login_request.rs`), while the waste domain predates it and pairs
  `seriesPayload.ts` ↔ `series_upsert.rs` (likewise grade/reason/worker, and
  `rangeFilter.ts` ↔ `range_query.rs`). Match the neighbours of whatever you
  are adding rather than renaming the existing set. `auth.ts` holds the
  account domain's status unions and every display/validation helper,
  re-exporting the response structs it works with; `auth.requests.ts`
  re-exports the `auth_*` command's request/response types the same way.
  `constants.ts` holds non-copy literals used in more than one place — route
  paths, toast lifetimes. `events.ts` sits outside the request/response split
  because a pushed event is neither: it holds `DataChanged`, mirroring
  `src-tauri/src/events.rs`.
- `assets/i18n/en.json` — every piece of on-screen copy, namespaced by view
  folder (`waste.*`, `grades.*`, …) plus shared `common.*`/`validation.*`
  namespaces; resolved with the `translate` pipe in templates and
  `TranslateService.instant()` in components. See the `extract-static-text`
  skill for the convention and the destination table (copy vs. `constants.ts`).

Every screen shares one date range (defaults to the current month) and an
optional series filter — that state lives above the view level, not per-screen.

### Theming

Every colour is a CSS custom property in
`web/src/assets/styles/base/_theme.scss` (`:root` = light, `.app-dark` = dark),
aliased to Sass names in `_tokens.scss`. Never hardcode a colour in a component
stylesheet. Because each alias holds a `var()` reference rather than a colour,
Sass colour functions (`darken()`, `rgba()`, …) don't work on them — reach for a
`--wash-*` token or a raw palette variable instead.

The app ships light (`web/src/index.html` is plain `<html lang="en">`); adding
`class="app-dark"` there switches both the app's own tokens and PrimeNG's dark
scheme at once, since `app.config.ts` sets `darkModeSelector: '.app-dark'` on
the preset. That preset is `web/src/app/theme.ts` (`WasteLogPreset`, a
`definePreset(Aura, …)` in navy) — the PrimeNG side of the palette, distinct
from the Sass tokens above. Barcode tiles, sheet header bands and grade colours
deliberately ignore the theme; see `.claude/rules/theming.md` for why.

### Accounts / licensing (Supabase)

A second, unrelated database bolted onto an otherwise offline app. Waste-log
data never touches it; it holds real user accounts, subscription status and
payment history, and only a registered account with an acceptable subscription
status can open the app.

Nothing about Supabase lives in `web/` — the project URL, anon key, session
tokens and licence check are all in `src-tauri/src/auth.rs` and `supabase.rs`.
Anything needing the service role key goes through an edge function
(`register`, `login`, `forgot-password`) via `supabase::call_function`; the rest
uses PostgREST with the anon key. A licence is bound to one PC by a device
fingerprint taken at registration and re-checked at every sign-in.


## Data model

SQLite, one connection guarded behind a mutex (`state.rs`) — this app targets
one terminal on one shop floor, so no connection pooling. Tables:
`series_of_product`, `reason`, `worker`, `grade`, `worker_log`, `barcode`.

## One deliberate scope boundary against `.claude/rules/`

`scaffold-entity`'s step 2 calls for a Tauri-calling service per entity — done
for series/reason/grade/worker/waste/barcode/settings/export (see `services/`
above). The account layer (`auth.service.ts`, `auth.backend.ts`,
`tauri-auth.backend.ts`) was deliberately left in `core/` rather than moved to
`services/auth/`: it was already fully compliant with `zone-wrapper.md` before
the rest of the split (only `tauri-auth.backend.ts` touches
`ZoneWrapperService`, exactly as the rule asks), and it is already its own
documented mini-layer (see "Accounts / licensing" below) rather than a CRUD
entity in the sense the rest of `services/` is. Nothing about this is a rule
violation — say so if a future change wants it moved for consistency anyway.

## Where the older docs have drifted

`README.md` and two `.claude/rules/` files predate the `zone-wrapper` split and
still name files that no longer exist. The rules below are still correct in
*substance* — follow them — but resolve the paths against this file, not them:

- `README.md`'s "How the two halves talk" and "Zones" sections, and all of
  `.claude/rules/tauri-ipc.md`, point at `web/src/app/core/tauri.service.ts`
  with `call()`/`on()`, and README also names `core/waste-log.service.ts`.
  Neither file exists. The IPC boundary is
  `core/zone-wrapper/zone-wrapper.service.ts` with `invoke()`/`listen()`, and
  the per-entity services live under `services/`.
- `.claude/rules/zone-wrapper.md`'s `paths:` globs are `src/app/**` rather than
  `web/src/app/**`, so they never match anything and the rule is unlikely to
  auto-attach. Read it deliberately when touching a service.
- README's command table omits the seven `auth_*` commands and `device_id`.
  `core/tauri/tauri-commands.const.ts` and `lib.rs`'s `generate_handler![]` are
  the authoritative list (37 commands).

Fixing these files is worth doing if you are already in them; the code is the
side that is right.
