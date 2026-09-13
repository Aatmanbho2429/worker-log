---
paths:
  - "web/src/app/**/*.ts"
  - "src-tauri/src/commands.rs"
  - "src-tauri/src/auth.rs"
  - "src-tauri/src/lib.rs"
---

# Tauri IPC boundary

Angular never calls `fetch`/HTTP for app data. The single `provideHttpClient()`
in `app.config.ts` exists only so `@ngx-translate` can load
`assets/i18n/en.json` through `core/custom-translate-loader.ts`. Everything
else crosses the bridge as a Tauri command or a pushed event.

## Names come from a registry, never a string literal

- Command names are `entity_action` in `snake_case` on the Rust side —
  `auth_login`, `waste_dashboard`. One command per action; never multiplex
  several operations behind one command with a type/action flag.
- Angular references them through `core/tauri/tauri-commands.const.ts`
  (`TAURI_COMMANDS`), one entry per `#[tauri::command]` registered in
  `lib.rs`. Events likewise through `core/tauri/tauri-events.const.ts`
  (`TAURI_EVENTS`) — today just `worker-log://data-changed`.
- A typo is then a compile error rather than a promise that rejects at
  runtime.

## Adding a command touches exactly three places

1. `commands.rs` (or `auth.rs`) — a `<name>_impl` function holding the real
   logic and returning `AppResult<T>`, plus the thin `#[tauri::command]`
   wrapper that calls it and converts with `.into()`. See
   `.claude/rules/api-response-format.md`.
2. `src-tauri/src/lib.rs`'s `generate_handler![]` list. Miss this and the call
   rejects at runtime with no compile error.
3. `core/tauri/tauri-commands.const.ts` — one `TAURI_COMMANDS` entry.

It does **not** touch `src-tauri/capabilities/default.json`. That file carries
plugin permissions only (`dialog:allow-save`, `opener:allow-open-path`,
`log:default`, `core:*`); every app command is reachable with none of them
listed, so an entry there would be meaningless text. If another doc tells you
to add one, `cat src-tauri/capabilities/default.json` and believe the file.

## Events

Rust pushes `worker-log://data-changed` with a scope — `waste`, `workers`,
`series`, `reasons`, `grades`, `everything` — telling each screen whether it
needs to reload. Angular consumes exactly one stream of these,
`core/data-changes.service.ts`; views subscribe to that rather than listening
themselves. The payload type is `models/events.ts`'s `DataChanged`, mirroring
`src-tauri/src/events.rs`.
