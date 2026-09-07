# Rules alignment plan

**Status: done.** Every workstream below (G, D, E, F, A, B, C, H) is
implemented and verified — `cargo build`/`cargo test`, `ng build`/`npm test`
all green as of the last pass. The one deliberate deviation from the plan as
written: the account trio (`auth.service.ts`, `auth.backend.ts`,
`tauri-auth.backend.ts`) stayed in `core/` rather than moving to
`services/auth/` under Workstream C step 5 — see CLAUDE.md's "One deliberate
scope boundary" section for why. The rest of the document below is kept as
the record of what was planned and audited; read CLAUDE.md for the current
state of the code, not this file.

Bring the codebase in line with every convention file in `.claude/` **except**
`skills/supabase/SKILL.md` (out of scope by request).

In scope: `rules/api-response-format.md`, `rules/data-model.md`,
`rules/models.md`, `rules/tauri-ipc.md`, `rules/theming.md`,
`rules/zone-wrapper.md`, `skills/scaffold-entity/SKILL.md`,
`skills/extract-static-text/SKILL.md`, and `CLAUDE.md` (updated last, to
describe the result).

Audited 2026-09-07 against the working tree. Counts below are measured, not
estimated.

---

## Two things to decide before starting

**1. The envelope loses the error taxonomy.** `api-response-format.md` wants
every command to return `ApiResponse<T> { statusCode, message, data }` and never
an `Err`. Today a rejection carries `AppError`'s `kind`
(`badRequest`/`notFound`/`conflict`/`internal`), and `notify.fromCommand()`
branches on it: the first three are shown to the operator as actionable
warnings, `internal` as a fault. A bare `statusCode` can carry that (400/404/409
→ warn, 500 → error), so **Workstream B maps kind → statusCode and keeps the
distinction**. Nothing is lost, but the mapping must be written down or the UI
silently starts calling validation problems faults.

**2. The capabilities instruction is a no-op.** `tauri-ipc.md` and
`scaffold-entity` step 8 say every new command needs an entry in
`src-tauri/capabilities/*.json`. Tauri v2 does not work that way for app
commands — `capabilities/default.json` carries plugin permissions only
(`dialog:allow-save`, `opener:allow-open-path`, `log:default`, …) and all 37
commands are reachable today with none of them listed. Adding entries would be
meaningless text. **Recommendation: fix the rule, not the code** — replace that
bullet with "register the command in `tauri::generate_handler![]` in `lib.rs`".
Flagged for confirmation; nothing else in the plan depends on it.

---

## Workstream G — data model audit (do first, likely no change)

`rules/data-model.md` describes what the register already does. Verify each
claim, fix only what fails:

1. One `worker_log` row per tap, counts always a `COUNT` over a range grouped by
   grade — check `repo/logs.rs` for any counter column or aggregate cache.
2. Deletes that would orphan history are refused with `Conflict`/`BadRequest`;
   worker delete is the one permitted cascade and the confirmation states the
   row count — check `repo/{series,reasons,grades,workers}.rs` and
   `commands::*_delete_impact`.
3. `barcode` backfilled for every worker × reason × grade on create **and** on
   startup — check `repo/barcodes.rs` and the startup path in `lib.rs`/`db.rs`.
4. Migrations numbered, `PRAGMA user_version`-tracked, idempotent, one
   transaction each — check `src-tauri/migrations/0001_init.sql`,
   `0002_grades.sql` and the runner in `db.rs`.

Deliverable: a short note per point in the PR description saying "compliant" or
what was fixed. **Risk: low. No API change.**

---

## Workstream E — theming (`rules/theming.md`)

10 hardcoded colours in component stylesheets. Three are sanctioned opt-outs the
rule names explicitly and they **stay**:

- `views/barcodes/barcodes.scss:406,423,427` — `#ffffff` / `#000000` barcode
  tiles (dark bars on white, deliberate).

To fix (6):

| File | Line | Value | Fix |
| --- | --- | --- | --- |
| `shared/scan-field/scan-field.scss` | 50 | `rgba(63, 111, 168, 0.22)` | new `--focus-ring` token in `_theme.scss`, aliased in `_tokens.scss` |
| `views/waste/waste.scss` | 86 | `rgba(63, 111, 168, 0.28)` | same `--focus-ring` (widen if the two rings must differ) |
| `views/waste/waste.scss` | 106 | `rgba(0, 0, 0, 0.24)` | new `--scrim` token |
| `views/waste/waste.scss` | 230 | `var(--grade-soft, #{rgba(224, 49, 49, 0.16)})` | keep `--grade-soft`, move the fallback into `_grades.scss` |
| `views/reports/reports.scss` | 77, 180 | `rgba($navy-300, .22)`, `rgba(112,152,203,.16)` | same treatment as above |
| `views/sheet/sheet.scss` | 83 | `rgba(255,255,255,0.72)` | header band is a sanctioned opt-out, but the value belongs in a `--band-ink-muted` token beside the band colour |

Then the second half of the rule: **22 inline `var(--…)` uses** in component
scss must become Sass aliases from `_tokens.scss`. Exception: `var(--grade-soft,
…)` is the grade-colour opt-out and stays, but each occurrence needs the
one-line comment saying so.

Verify with `npm run web:build` and a visual pass over waste / reports / sheet /
barcodes in both themes. **Risk: low, but visual — check dark mode explicitly.**

---

## Workstream F — copy and constants (`skills/extract-static-text`)

Measured: **~108 template literals** across 10 view folders and 2 shared
components, **16 user-facing strings** in view TypeScript, **6 confirm dialogs**.
`auth/*`, `profile/`, `layout/shell/` are already done and are the reference.

Per view folder, one at a time (the skill has the full procedure):

| Folder | Literals |
| --- | --- |
| `views/workers` | ~19 |
| `views/reports` | ~17 |
| `views/grades` | ~12 |
| `views/barcodes`, `views/series`, `views/waste` | ~11 each |
| `views/reasons` | ~9 |
| `views/sheet` | ~7 |
| `views/settings` | ~5 |
| `shared/scan-field` | ~4 |
| `shared/range-filter` | ~2 |

Then TypeScript: `export.service.ts:74`, `barcodes.ts:345`, `grades.ts:108`,
`reports.ts:121`, `workers.ts:92` and the rest of the 16, plus the 6 confirm
dialogs (`message`/`header`/`acceptLabel`/`rejectLabel`).

New file `web/src/app/models/constants.ts` for the non-copy literals:

- 12 route paths (`/waste`, `/login`, `/grades`, `/reasons`, `/workers`, …) used
  in `router.navigate()` and `routerLink`.
- Toast lifetimes currently inline in `notify.service.ts` (2500/3000/4000/6000).
- Any scan timing thresholds in `scan.service.ts` worth naming.

Leave `DATA_CHANGED` (`models/events.ts`) and the validation patterns
(`models/auth.ts`) where they are — the skill says so.

Verify: `node -e "JSON.parse(…en.json)"`, then grep each new key back out of
`en.json` (a missing key renders as the key and still builds), then
`npm run web:build` and `npm test`. **Risk: low per view, high volume — one
commit per view folder.**

---

## Workstream D — command and event registries (`rules/tauri-ipc.md`)

**32 command-name literals** in `core/waste-log.service.ts`; the 8 auth ones are
already centralised in `models/auth.requests.ts` as `AUTH_COMMANDS`.

1. Create `web/src/app/core/tauri/tauri-commands.const.ts` holding every command
   name (`app_info`, `device_id`, the 6 CRUD sets, `waste_dashboard`,
   `waste_logs`, `add_waste_entry`, `undo_waste_entry`, `export_waste_pdf`,
   `export_waste_csv`, `barcode_sheet`, `record_scan`, `export_barcodes_pdf`,
   `seed_demo_data`) plus the 8 from `AUTH_COMMANDS`, `as const`.
2. Create `web/src/app/core/tauri/tauri-events.const.ts` and move
   `DATA_CHANGED` there from `models/events.ts` (leave `ChangeScope`,
   `DataChanged` and `affects()` in the model file).
3. Replace all 32 literals; delete `AUTH_COMMANDS` from `auth.requests.ts` and
   repoint `tauri-auth.backend.ts`.
4. Cross-check the constant list against `tauri::generate_handler![]` in
   `src-tauri/src/lib.rs` — 37 entries — so nothing is missing or stale.

Verify: `npm run web:build`, `npm test`, and launch the app to click through
each screen (a wrong command name is a runtime rejection, not a compile error).
**Risk: low, mechanical. Independent of every other workstream.**

---

## Workstream A — models tree split (`rules/models.md`, `scaffold-entity`)

Today: Rust models are one flat `src-tauri/src/models.rs` (242 lines) plus
structs scattered in `commands.rs` (`AppInfo`, `GradeDeleteImpact`,
`DeleteImpact`, `ScanReceipt`), `barcode.rs` (`Scan`, `Symbol`),
`barcode_sheet.rs` (`GradeTile`, `WorkerRow`, `ReasonSheet`, `Sheet`) and
`auth.rs` (8 structs). `src-tauri/src/models/request/` and `…/response/` exist
but are **empty**. Angular models are flat too: `index.ts`, `auth.ts`,
`auth.requests.ts`, `events.ts`.

Split by direction — anything the front end sends is a request, anything it
receives is a response:

**Requests** — `SeriesUpsert`, `ReasonUpsert`, `WorkerUpsert`, `GradeUpsert`,
`LogEntryRequest`, `RangeQuery`, `RegisterRequest`, `LoginRequest`,
`ChangePasswordRequest`.

**Responses** — `SeriesOfProduct`, `Reason`, `Worker`, `Grade`, `WorkerLog`,
`Dashboard`, `DashboardRow`, `DashboardCell`, `AppInfo`, `GradeDeleteImpact`,
`DeleteImpact`, `ScanReceipt`, `Symbol`, `GradeTile`, `WorkerRow`,
`ReasonSheet`, `Sheet`, `UserAccount`, `Subscription`, `Payment`, `Session`,
`PasswordReset`.

Naming per the rule: Rust `snake_case.rs` → `PascalCase` struct
(`series_upsert.rs` → `SeriesUpsert`), TS `camelCase.ts` suffixed
`request`/`response` (`seriesUpsertRequest.ts`). Every TS file gets a
same-named Rust counterpart and vice versa; keep `#[serde(rename_all =
"camelCase")]` on all of them.

Two judgement calls, resolve while implementing:

- `Scan` and `Symbol` are internal barcode types with real symbology tests
  against them. `Symbol` crosses the wire (it is `BarcodeSymbol` in TS) so it is
  a response; `Scan` does not — leave it in `barcode.rs`.
- `workerFullName()` and `sumCounts()` in `models/index.ts` are behaviour, not
  models. Move to `core/` rather than dragging them into the split tree.

Verify: `cargo test`, `cargo build`, `npm run web:build`, `npm test`.
**Risk: medium — wide but mechanical. Land before Workstream B; the envelope
change is easier once each model has its own file.**

---

## Workstream B — `ApiResponse<T>` envelope (`rules/api-response-format.md`)

The big one: **37 commands** (30 in `commands.rs`, 7 in `auth.rs`) plus every
call site.

Rust:

1. Add `models/response/api_response.rs` — `ApiResponse<T> { status_code: u16,
   message: String, data: T }`, `#[serde(rename_all = "camelCase")]`, with
   `ok(data)` and `from_error(AppError)` constructors.
2. Map `AppError::kind()` → status code once, in `error.rs`: `badRequest` → 400,
   `notFound` → 404, `conflict` → 409, `internal`/`Database` → 500. Keep the
   existing `log::error!` on the internal arms.
3. Change every command signature from `AppResult<T>` to `ApiResponse<T>` and
   catch at the boundary. **Keep `AppError` and `AppResult` inside `repo/` and
   the service layer** — only the command wrapper flattens to the envelope, so
   the error taxonomy stays intact where the logic lives.
4. `CommandError` in `error.rs` becomes dead once nothing rejects; delete it in
   the same change.

TypeScript (lands with Workstream C):

5. `ApiResponse<T>` in `models/response/apiResponse.ts`, mirroring the Rust
   struct.
6. The wrapper unwraps `.data` on 2xx and throws on anything else, so no service
   or component ever sees the envelope.
7. Rewrite `isCommandError`/`CommandError` in terms of `statusCode`, and
   `notify.fromCommand()` to warn on 400/404/409 and error on 500 — the
   behaviour it has today via `kind`.

Verify: `cargo test`, `cargo build`, `npm test`, then a full manual pass —
**every rejection path must be exercised by hand**: delete a series that has
workers (409), delete the last grade (400), scan a foreign barcode, sign in with
a wrong password, and force an internal error. Unit tests will not catch a
mis-mapped status code.

**Risk: high. Touches every command and every error path. One PR, no other
work mixed in.**

---

## Workstream C — `ZoneWrapperService` and the service layer (`rules/zone-wrapper.md`, `scaffold-entity`)

`core/tauri.service.ts` already does exactly what the rule describes — runs
`invoke` outside the zone and re-enters, registers `listen` outside and runs
handlers inside. What differs is name, location and the envelope unwrap.

1. Move `core/tauri.service.ts` → `core/zone-wrapper/zone-wrapper.service.ts`;
   class `TauriService` → `ZoneWrapperService`; `call()` → `invoke()`,
   `on()` → `listen()`. Keep the zone comments verbatim — they are the reason
   the file exists.
2. Add the `.data` unwrap from Workstream B step 6.
3. Move `core/tauri.service.spec.ts` alongside and extend it: envelope unwrap on
   success, throw on error status, handler runs inside the zone.
4. Repoint the 5 importers: `waste-log.service.ts`, `tauri-auth.backend.ts`,
   `notify.service.ts`, `shared/scan-field/scan-field.ts`, and the spec.
5. `scaffold-entity` puts services at `web/src/app/services/<Entity>/<Entity>.service.ts`,
   one per entity, and `zone-wrapper.md`'s own `paths:` says `src/app/services/**`.
   Today there is one `core/waste-log.service.ts` covering 32 commands. Split it
   into `services/series/`, `services/reason/`, `services/grade/`,
   `services/worker/`, `services/waste/`, `services/barcode/`, and move
   `export.service.ts` / `scan.service.ts` / `auth.service.ts` under `services/`
   too. `core/` keeps only the zone wrapper, guards, `notify.service.ts` and the
   small helpers.

Verify: `npm test`, `npm run web:build`, then run the app and exercise every
screen — the split changes injection sites in ~12 components.

**Risk: high (step 5 especially). Do steps 1–4 with Workstream B, then step 5
as its own change.**

---

## Workstream H — documentation

Once the code matches:

1. Update `CLAUDE.md` — the architecture section still describes `core/` holding
   the services and `tauri.service.ts` as the IPC boundary; rewrite for
   `services/*`, `core/zone-wrapper/`, the envelope, and the models tree.
2. Update `.claude/rules/tauri-ipc.md` per decision 2 above (capabilities
   bullet), if confirmed.
3. `scaffold-entity` becomes accurate for the first time — walk its 9 steps
   against the new tree and correct anything left stale.

---

## Suggested order

Cheap and independent first, so the risky refactors land in a codebase that is
already consistent everywhere else:

1. **G** audit (no change expected)
2. **D** registries (mechanical, isolated)
3. **E** theming (visual check in both themes)
4. **F** copy + constants (highest volume, one commit per view)
5. **A** models split (wide, mechanical)
6. **B + C steps 1–4** envelope + zone wrapper (**one PR, manual error-path pass**)
7. **C step 5** service-per-entity split
8. **H** docs

Full gate after each: `cargo test --manifest-path src-tauri/Cargo.toml`,
`npm test` and `npm run web:build` from `web/`, plus `npm run dev` and a click
through every screen for 5–8. There is no linter; run
`npx prettier --write` from `web/` on touched files.
