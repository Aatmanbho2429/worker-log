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
npm test -- --include src/app/core/scan.service.spec.ts   # one spec file
npm test -- --filter "keyboard wedge"                 # tests whose name matches a regex
```

Tests run through Angular's `@angular/build:unit-test` builder (vitest under
jsdom, no `vitest.config.ts`). Calling `npx vitest` directly fails — the builder
is what initialises the TestBed, so always go through `npm test`.

There is no linter configured. Formatting is Prettier 3 against `web/.prettierrc`
(100 columns, single quotes, `angular` parser for templates) — there is no
`format` script, so run `npx prettier --write <paths>` from `web/`.

Rust tests are plain `#[test]` functions inline in the modules under
`src-tauri/src/` (`barcode.rs`, `barcode_sheet.rs`, `db.rs`, `report.rs`):

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
├── web/               Angular 21 + PrimeNG 21 front end
└── supabase/          edge functions + SQL for the account/licence backend
```

(`supabase/` is tracked in git but currently deleted in the working tree — the
Rust side still calls those edge functions, so restore it with
`git checkout supabase` before editing them.)

`npm run dev` is `tauri dev`: `tauri.conf.json`'s `beforeDevCommand` starts the
Angular dev server on `:4200` and the Tauri window points at it. `npm run build`
runs `web`'s production build and bundles `web/dist/CeramicWasteLog/browser`.

### The two halves talk over Tauri IPC, not HTTP

Angular never calls `fetch`/HTTP for app data. Entity services under
`web/src/app/services/` (see below) invoke Tauri commands defined in
`src-tauri/src/commands.rs` and `auth.rs` (full command table in the README),
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
- `views/` — one folder per screen (`waste`, `sheet`, `reports`, `barcodes`,
  `workers`, `series`, `reasons`, `grades`, `settings`, `auth/login`,
  `auth/register`, `profile`).
- `shared/` — reusable pieces (`scan-field`, `range-filter`) used across views.
- `models/` — DTOs shared with Rust, split by direction per
  `.claude/rules/models.md`: `models/request/` (payloads, `RangeFilter`,
  `RegisterRequest`, …) and `models/response/` (`Grade`, `Dashboard`,
  `UserAccount`, …), one type per file, both re-exported flatly through
  `models/index.ts` so the rest of the app keeps writing
  `import { Grade } from '../../models'`. `auth.ts` holds the account domain's
  status unions and every display/validation helper, re-exporting the response
  structs it works with; `auth.requests.ts` re-exports the `auth_*` command's
  request/response types the same way. `constants.ts` holds non-copy literals
  used in more than one place — route paths, toast lifetimes.
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
stylesheet.

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
