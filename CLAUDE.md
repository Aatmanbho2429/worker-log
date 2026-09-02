## What this is

A desktop replacement for the paper waste register kept on a ceramic sanitaryware
line: who lost a piece, where it was lost, and which grade it came off the line
as. Ships as a native app — Tauri 2 shell, Angular 21 UI, Rust core, one SQLite
file. No server to run, no browser, no network for the register itself (there
is a small Supabase-backed account/licensing layer — see below).

Standing conventions that should always be enforced (the Tauri IPC boundary,
colour tokens, auth-DTO sync, data-model guards) live in `.claude/rules/` rather
than here — see those files for the specifics and reasoning.

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
npm test                          # ng test — runs the vitest suite
npx vitest run path/to.spec.ts    # a single spec file
```

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

### The two halves talk over Tauri IPC, not HTTP

Angular never calls `fetch`/HTTP for app data. `web/src/app/core/waste-log.service.ts`
invokes Tauri commands defined in `src-tauri/src/commands.rs` (full command table
in the README), and Rust pushes `worker-log://data-changed` events back with a
scope (`waste`, `workers`, `series`, `reasons`, `grades`, `everything`) that
tells each screen whether to reload.

`web/src/app/core/tauri.service.ts` is the only file allowed to touch
`invoke`/`listen` directly — see `.claude/rules/tauri-ipc.md` for why and what
that means for new code.

A rejected command resolves to `{ kind, message }` (`badRequest` / `notFound` /
`conflict` / `internal`, defined by `src-tauri/src/error.rs`'s `AppError`) — the
front end shows the first three as actionable warnings and the last as a fault.

### Rust side (`src-tauri/src`)

- `commands.rs` — the `#[tauri::command]` entry points the front end calls for
  everything except auth (series/reason/grade/worker CRUD, waste dashboard/log,
  exports, barcode sheet/scan, seeding).
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
- `error.rs` — `AppError` → `{kind, message}`, the shape every rejected
  `invoke` resolves to on the JS side.
- `auth.rs` + `supabase.rs` — the account/licence layer, separate from the
  waste-log data model entirely (see below).

### Angular side (`web/src/app`)

Standalone components with signals, PrimeNG 21 Aura preset. Structure:

- `core/` — services with no UI: `waste-log.service.ts` (the command surface),
  `tauri.service.ts` (the only IPC boundary), `auth.service.ts` +
  `auth.backend.ts`/`tauri-auth.backend.ts` (account/session), `export.service.ts`,
  `scan.service.ts` (keyboard-wedge barcode scan detection), `notify.service.ts`.
- `views/` — one folder per screen (`waste`, `sheet`, `reports`, `barcodes`,
  `workers`, `series`, `reasons`, `grades`, `settings`, `auth/login`,
  `auth/register`, `profile`).
- `shared/` — reusable pieces (`scan-field`, `range-filter`) used across views.
- `models/` — DTOs shared with Rust; the account ones (`auth.ts`,
  `auth.requests.ts`) mirror `src-tauri/src/auth.rs`'s structs field-for-field
  (`.claude/rules/auth-model-sync.md`).

Every screen shares one date range (defaults to the current month) and an
optional series filter — that state lives above the view level, not per-screen.

### Theming

Every colour is a CSS custom property in
`web/src/assets/styles/base/_theme.scss` (`:root` = light, `.app-dark` = dark),
aliased to Sass names in `_tokens.scss`. Never hardcode a colour in a component
stylesheet — see `.claude/rules/theming.md` and README's "Theming" section.

### Accounts / licensing (Supabase)

All users are in supabase. This is a seperate database from the sqlliet local database.
Only the registered user with appropriate subscription status will be able to login this app.
These database contains the real user information. All the registration , login is done in supabase and we have appropriate edge functions for that. Refer (`.claude/skills/supabase/SKILL.md`)


## Data model

SQLite, one connection guarded behind a mutex (`state.rs`) — this app targets
one terminal on one shop floor, so no connection pooling. Tables:
`series_of_product`, `reason`, `worker`, `grade`, `worker_log`, `barcode`. See
README's "Data model" and "Migrations" sections for the full column list, and
`.claude/rules/data-model.md` for the guard rules (one row per tap, no orphaning
deletes, `barcode` backfill, idempotent migrations).
