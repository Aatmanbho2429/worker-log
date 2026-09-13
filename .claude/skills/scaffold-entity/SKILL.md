---
name: scaffold-entity
description: Scaffold a new entity end-to-end — Angular request/response models, an Angular service, Tauri request/response models, repo SQL and Tauri commands — following this project's conventions. Use when the user asks to add a new entity, resource, or API endpoint, e.g. "add a product entity" or "wire up a new users API".
argument-hint: [entityName]
---

# Scaffold a new entity: $ARGUMENTS

Create every piece needed for a new entity called `$ARGUMENTS`, following
`.claude/rules/models.md`, `.claude/rules/tauri-ipc.md` and
`.claude/rules/api-response-format.md`.

## Steps

1. **Angular models** — one file per type in `web/src/app/models/request/` and
   `web/src/app/models/response/` (flat, not per-entity folders), camelCase
   fields, exported from the matching `index.ts`. See `models.md`, including
   its note on which naming convention the neighbouring files use.
2. **Angular service** — `web/src/app/services/<entityName>/<entityName>.service.ts`.
   Inject `ZoneWrapperService`; every method calls `zoneWrapper.invoke()`,
   never `invoke` directly. See `zone-wrapper.md`.
3. **Command name constants** — add an entry per command to
   `web/src/app/core/tauri/tauri-commands.const.ts`, `entity_action`
   snake_case. See `tauri-ipc.md`.
4. **Rust models** — one struct per file in `src-tauri/src/models/request/`
   and `src-tauri/src/models/response/` (again flat), mirroring the TS models
   field-for-field with `#[serde(rename_all = "camelCase")]`, and re-exported
   from the matching `mod.rs`.
5. **SQL** — a new module in `src-tauri/src/repo/` holding this table's
   queries, alongside `workers.rs`, `series.rs`, `logs.rs` and the rest.
   There is no `src-tauri/src/services/` in this project. If the entity needs
   a table, add the next numbered migration under `src-tauri/migrations/` —
   see `.claude/rules/data-model.md` for how one must be written.
6. **Commands** — add the `<name>_impl` + `#[tauri::command]` pair to the
   single `src-tauri/src/commands.rs` (there is no `commands/` directory).
   The impl returns `AppResult<T>`; the wrapper returns `ApiResponse<T>` via
   `.into()`. See `api-response-format.md`.
7. **Register** — add each command to `generate_handler![]` in
   `src-tauri/src/lib.rs` (not `main.rs`). Missing this fails only at runtime.
8. **Emit a change event** if the new data is shown on a screen that another
   screen can invalidate — `src-tauri/src/events.rs`, consumed through
   `core/data-changes.service.ts`.

Nothing needs adding to `src-tauri/capabilities/default.json`; it carries
plugin permissions only. See `tauri-ipc.md`.

## After scaffolding

Confirm both model trees mirror each other one-for-one, that no service
imports `@tauri-apps/api` directly (only `zone-wrapper.service.ts` may), and
that every new command appears in all three of: `commands.rs`,
`generate_handler![]`, and `tauri-commands.const.ts`.
