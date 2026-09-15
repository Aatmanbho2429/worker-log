# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keep this file short

This file is the map, not the territory: what the app is, how to run it, where
things live, and which door to open for detail. Detail itself belongs in
`.claude/rules/` (standing conventions, auto-attached by `paths:`) or
`.claude/skills/` (multi-step procedures) — see the table at the bottom.

So: **when `/init` runs here, or when you are adding something you learned, do
not grow this file.** Put the knowledge in the rule or skill that owns that
area, and add at most a pointer here. If no rule owns it, create one — a new
`.claude/rules/<topic>.md` with a `paths:` glob is cheaper than another
paragraph here, because it loads only when someone touches that area. Anything
here is in context for *every* turn, so it has to earn the space. If a section
below has grown past a short paragraph, that is a bug: move it out.

## What this is

A desktop replacement for the paper waste register kept on a ceramic
sanitaryware line: who lost a piece, where it was lost, and which grade it came
off the line as. Ships as a native app — Tauri 2 shell, Angular 21 UI, Rust
core, one SQLite file. No server to run, no browser, no network for the
register itself (there is a small Supabase-backed account/licensing layer).

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
npm test                                                   # the whole vitest suite
npm test -- --watch=false                                  # one-shot run from an interactive shell
npm test -- --include src/app/core/scan.service.spec.ts    # one spec file (path is web/-relative)
npm test -- --filter "keyboard wedge"                      # tests whose name matches a regex
```

Two traps. Tests run through Angular's `@angular/build:unit-test` builder
(vitest under jsdom, no `vitest.config.ts`) — `npx vitest` directly fails,
because the builder is what initialises the TestBed, so always go through
`npm test`. And `--watch` defaults to **true in a TTY**, so a bare `npm test`
at a prompt sits in watch mode rather than exiting.

Coverage is four spec files — `core/scan.service.spec.ts`,
`core/zone-wrapper/zone-wrapper.service.spec.ts`, `models/auth.spec.ts`,
`shared/scan-field/scan-field.spec.ts`. Nothing under `views/` or `services/`
is covered.

Rust tests are plain `#[test]` functions inline in the modules under
`src-tauri/src/` (`barcode.rs`, `barcode_sheet.rs`, `db.rs`, `report.rs`,
`models/response/api_response.rs`):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Seeding/resetting demo data without opening a window:

```bash
cargo run --manifest-path src-tauri/Cargo.toml -- seed          # empty register only
cargo run --manifest-path src-tauri/Cargo.toml -- seed --force  # clear and reseed
```

`WORKER_LOG_DB` overrides the SQLite file location for both the app and the
seeder — set it during dev to avoid touching a real register.

There is no linter. Formatting is Prettier 3 against `web/.prettierrc` (100
columns, single quotes, `angular` parser for templates); there is no `format`
script, so run `npx prettier --write <paths>` from `web/`.

## Architecture

```
worker-log/
├── package.json     root — `npm run dev` / `npm run build`
├── src-tauri/       Rust: Tauri commands, SQLite, PDF writer, account/licence
├── supabase/        edge-function + migration sources for the account layer
└── web/             Angular 21 + PrimeNG 21 front end
```

`npm run dev` is `tauri dev`: `tauri.conf.json`'s `beforeDevCommand` starts the
Angular dev server on `:4200` and the Tauri window points at it. `npm run build`
runs `web`'s production build and bundles `web/dist/CeramicWasteLog/browser`.

**The two halves talk over Tauri IPC, not HTTP.** Angular calls commands
defined in `src-tauri/src/commands.rs` and `auth.rs`; Rust pushes
`worker-log://data-changed` events back. Every command answers with an
`ApiResponse<T>` envelope rather than rejecting, and
`core/zone-wrapper/zone-wrapper.service.ts` is the single file allowed to touch
`invoke`/`listen`. The authoritative command list is
`lib.rs`'s `generate_handler![]` and `core/tauri/tauri-commands.const.ts`, in
step with each other. Details — and the three places adding a command touches —
in `.claude/rules/tauri-ipc.md`, `zone-wrapper.md`, `api-response-format.md`.

### Rust (`src-tauri/src`)

- `commands.rs` — every `#[tauri::command]` except auth: series/reason/grade/
  worker CRUD, waste dashboard/log, exports, barcode sheet/scan, seeding.
- `auth.rs` + `supabase.rs` — the account/licence layer, entirely separate from
  the waste-log data model. Thirteen `auth_*` commands. See the `supabase` skill.
- `repo/` — one module per table holding its SQL (`workers.rs`, `series.rs`,
  `reasons.rs`, `grades.rs`, `logs.rs`, `barcodes.rs`).
- `models/` — everything crossing the bridge, split `request/` ÷ `response/`,
  one struct per file. See `.claude/rules/models.md`.
- `db.rs` — connection setup and migrations. `state.rs` — `AppState` (the
  guarded single connection) and app-data-directory resolution. `error.rs` —
  `AppError` and its `status_code()`.
- `barcode.rs` / `barcode_sheet.rs` — Code 128 encoding and the printed
  scanning-sheet layout. Both carry real symbology-correctness tests, not smoke
  tests; read README's "The payload" section before touching either.
- `pdf.rs` — the self-contained PDF writer (base-14 Helvetica, no bundled
  fonts). Latin-only: names in another script render as `?`, and CSV export is
  the escape hatch (`report.rs` / `commands::export_waste_csv`).

### Angular (`web/src/app`)

Standalone components with signals. `core/` holds cross-cutting services with
no UI (the IPC wrapper, the command/event registries, `data-changes.service.ts`,
auth/session, `scan.service.ts` for keyboard-wedge barcode detection, notify,
guards); `services/` holds one Tauri-calling service per entity; `layout/shell/`
is the chrome every signed-in screen renders inside; `views/` is one folder per
screen; `shared/` holds reusable pieces plus the single PrimeNG import module;
`models/` mirrors the Rust DTOs; `assets/i18n/en.json` holds all copy.

Conventions — the PrimeNG module, copy in `en.json`, the shared date range,
routing and guards — are in `.claude/rules/angular-ui.md`. Colours are in
`.claude/rules/theming.md`, type/spacing/layout in `ui-design-system.md`; never
hardcode either.

## Data model

SQLite, one connection guarded behind a mutex (`state.rs`) — this app targets
one terminal on one shop floor, so no connection pooling. Tables:
`series_of_product`, `reason`, `worker`, `grade`, `worker_log`, `barcode`. The
invariants the schema does not show — one row per grade tap rather than a
counter, which deletes are refused instead of cascading, the `barcode` backfill
every new worker/reason/grade owes, how a migration must be written — are in
`.claude/rules/data-model.md`.

## Where the detail lives

`.claude/rules/` auto-attach by `paths:`; skills are invoked by name or matched
from their description.

| Door | Opens onto |
| --- | --- |
| `rules/tauri-ipc.md` | command/event naming, the three places a new command touches, what `capabilities/` really does |
| `rules/zone-wrapper.md` | why only one file may call `invoke`/`listen`, and the error `kind`s |
| `rules/api-response-format.md` | the `ApiResponse` envelope and the `<name>_impl` + wrapper shape |
| `rules/models.md` | the request/response split both sides, and where it isn't retrofitted |
| `rules/data-model.md` | waste-log invariants, refused deletes, migration style |
| `rules/angular-ui.md` | PrimeNG module, i18n copy, shared range state, routing |
| `rules/theming.md` | the medium blue/grey/slate palette, semantic colour tokens, the two palettes, and the three things that opt out |
| `rules/ui-design-system.md` | where CSS lives (no component stylesheets), BEM rules, type scale, spacing, control sizes, screen anatomy, declutter and contrast rules |
| `skills/supabase/` | the whole account layer — auth, licence binding, plans, Razorpay — its design decisions, and what is live |
| `skills/scaffold-entity/` | adding an entity end-to-end |
| `skills/extract-static-text/` | moving copy into `en.json` and literals into `constants.ts` |

`.claude/plans/` is for work in progress only. Once a plan ships, fold its
lasting reasoning into the skill or rule that owns that area and delete the
plan. In flight now: `controls-refresh.md` — inputs, buttons, and the move back
to a 16px root.

## Known doc drift

`README.md` predates the current structure: its "How the two halves talk" and
"Zones" sections name `core/tauri.service.ts` with `call()`/`on()` and
`core/waste-log.service.ts`, neither of which exists, and its command table
omits the thirteen `auth_*` commands and `device_id`. The substance is still
right; resolve paths and counts against this file and the rules instead. Worth
fixing if you are already in it.
