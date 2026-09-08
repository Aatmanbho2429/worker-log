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
├── supabase/         edge-function + migration sources for the account layer
└── web/               Angular 21 + PrimeNG 21 front end
```

`supabase/` is tracked again and is the account layer's server side. Commit
`e27bffd` had deleted it; `3056413` restored it along with the OTP pieces,
`b92fa42` added `validate-token`, and two later changes added `get-plans` and
then the Razorpay pair. It now holds `README.md`, `config.toml`, three
migrations (`0001_account_schema.sql`, `0002_email_otps.sql`,
`0003_payments.sql`) and eight edge functions — `register`, `login`,
`validate-token`, `forgot-password`, `send-otp`, `get-plans`, `create-order`,
`verify-payment` — each a single self-contained file with no shared imports,
so it can be pasted into the dashboard as-is. Nothing in this repo deploys them:
`src-tauri/src/supabase.rs` calls them by name over HTTP, and what is actually
live is recorded in `.claude/plans/` (see below), not inferable from the tree.

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
`opener:allow-open-path`, `log:default`, `core:*`); all 42 app commands are
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
  waste-log data model entirely (see below). `auth.rs` holds the twelve
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
- `shared/` — reusable pieces (`scan-field`, `range-filter`) used across views,
  plus `primeng-components-module.ts`: the PrimeNG surface the app actually
  uses bundled into one `NgModule` (with `CommonModule`, `FormsModule`,
  `RouterModule` and `TranslateModule` riding along) so a standalone view
  imports one symbol instead of a dozen. Every view and both shared
  components import it — add to it rather than importing a PrimeNG module
  directly into a view.
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
payment history. A lapsed subscription does not stop the account signing
in — only `status` (active/inactive/blocked) and the device binding gate that.
It stops everything past the profile screen instead: `authGuard`
(`core/auth.guard.ts`) redirects every other route there once
`AuthService.subscriptionExpired()` is true, and the shell hides the Floor and
Masters nav sections for the same reason (`shell.ts`'s `visibleSections`) so
nothing is left to click that would only bounce back. The profile shows the
renewal catalogue in a dialog (`auth_plans` → `get-plans`, fetched only while
the subscription reads `expired` or `expiring`) that auto-opens once per
session the first time that becomes true, and reopens from a "View plans"
button on the subscription card afterwards. Picking a plan there
(`Profile.selectPlan`) opens Razorpay's checkout widget through
`RazorpayService` (`core/razorpay.service.ts` — the one file in `web/` that
reaches a third-party host directly, and deliberately so: a card form needs a
browser context Rust does not have), then hands what the widget reports to
`auth_verify_payment` → `verify-payment`, which recomputes the payment's
HMAC signature server-side before recording it — nothing the widget says is
trusted until then. `auth_verify_payment` answers with a freshly rebuilt
`Session`; `AuthService.verifyPayment` replaces the session signal with it,
which is what clears `subscriptionExpired()` and brings the nav back without
a reload. `tauri.conf.json`'s `security.csp` is scoped to `razorpay.com`
hosts to let the checkout script load at all — the default `script-src
'self'` this app otherwise runs under would refuse it silently, and its
`connect-src` line deliberately keeps Tauri's own `ipc:` / `http://ipc.localhost`
origins alongside the Razorpay ones, since writing an explicit `connect-src`
replaces rather than extends the implicit `default-src 'self'` every other
command was reaching `invoke` through.

Nothing about Supabase lives in `web/` — the project URL, anon key, session
tokens and licence check are all in `src-tauri/src/auth.rs` and `supabase.rs`.
Anything needing the service role key goes through an edge function
(`register`, `login`, `validate-token`, `forgot-password`, `send-otp`,
`get-plans`, `create-order`, `verify-payment`) via `supabase::call_function`;
the rest uses PostgREST with the anon key. Two exceptions worth flagging:
`get-plans` takes no token and is callable whether anyone is signed in or
not, because the operator it exists for is the one whose token may be
mid-refresh; `create-order` and `verify-payment` carry the operator's
`accessToken` in the request body rather than an `Authorization` header
(`supabase::call_function` always sets that header to the bare anon key), and
check it themselves with `auth.getUser()`, the same pattern `validate-token`
already uses.

Signing in goes through the `login` function too, rather than GoTrue directly,
because the device-binding check (and claiming an unbound licence) needs that
key — `auth.rs`'s own `sign_in` survives only for `auth_change_password`, which just
re-proves a password. Registering is two steps: `auth_send_otp` mails a
4-digit code (rate-limited per address in the function, hashed into
`email_otps`, never stored in the clear), then `auth_register` verifies it and
creates the account in one call — nothing is written until the code checks
out.

A licence is bound to one PC by a device fingerprint taken at registration (or
claimed by the first machine to sign in, for a row left unbound) and
re-checked at every sign-in and again every six hours while the window stays
open (`AuthService`'s `validate()` timer, `auth_validate` → `validate-token`)
— so a subscription lapsing, or a device unbound from the dashboard, is
noticed without the operator closing and reopening the app.


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
documented mini-layer (see "Accounts / licensing" above) rather than a CRUD
entity in the sense the rest of `services/` is. Nothing about this is a rule
violation — say so if a future change wants it moved for consistency anyway.

## Where the older docs have drifted

`README.md`, `supabase/README.md`, two `.claude/rules/` files and the
`scaffold-entity` skill all name files or facts that no longer hold. They are
still correct in *substance* — follow them — but resolve the paths and counts
against this file, not them:

- `README.md`'s "How the two halves talk" and "Zones" sections, and all of
  `.claude/rules/tauri-ipc.md`, point at `web/src/app/core/tauri.service.ts`
  with `call()`/`on()`, and README also names `core/waste-log.service.ts`.
  Neither file exists. The IPC boundary is
  `core/zone-wrapper/zone-wrapper.service.ts` with `invoke()`/`listen()`, and
  the per-entity services live under `services/`.
- `.claude/rules/zone-wrapper.md`'s `paths:` globs are `src/app/**` rather than
  `web/src/app/**`, so they never match anything and the rule is unlikely to
  auto-attach. Read it deliberately when touching a service.
- README's command table omits the twelve `auth_*` commands and `device_id`.
  `core/tauri/tauri-commands.const.ts` and `lib.rs`'s `generate_handler![]` are
  the authoritative list (42 commands).
- The `scaffold-entity` skill's steps 4–8 describe a Rust layout this project
  never adopted: there is no `src-tauri/src/services/` and no
  `src-tauri/src/commands/` directory (logic lives in `repo/` and the commands
  in the single `commands.rs`), models are one flat file per struct rather than
  per-entity subdirectories, registration happens in `lib.rs` not `main.rs`,
  and the `code-comments.md` it cites does not exist. Steps 1–3 are accurate.
- `supabase/README.md` was rewritten alongside `get-plans` and the Razorpay
  pair and is kept in step with `supabase/config.toml` each time a function is
  added — no known drift in it as of this writing. Worth a second look
  anyway before trusting it blindly; the pattern with every file on this list
  is that it drifts the moment nobody is in it for a change.
- `.claude/rules/api-response-format.md`'s third `paths:` glob is
  `src-tauri/src/commands/**/*.rs`, a directory that does not exist; the rule
  still auto-attaches through its two model globs.

Fixing these files is worth doing if you are already in them; the code is the
side that is right.

## `.claude/plans/`

Two design notes for the account layer, both written before the work shipped
and both still ending in a deployment checklist: `otp-registration.md` (the
two-step register flow) and `token-validation.md` (sign-in plus the six-hourly
re-check). The code they describe is in the tree; what they say about **what
is deployed** is the part to re-check, since nothing in this repo pushes an
edge function. Read them before changing `auth.rs`, `supabase.rs` or anything
under `supabase/functions/` — they carry the reasoning (why the OTP is hashed
with a pepper, why `login` moved off GoTrue) that the code only implies.
