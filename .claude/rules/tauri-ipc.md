---
paths:
  - "web/src/**/*.ts"
---

# Tauri IPC boundary

Only `web/src/app/core/tauri.service.ts` may call `@tauri-apps/api`'s
`invoke`/`listen` directly. Every other service or component goes through it
(`call()` for commands, `on()` for events).

Why: Tauri delivers events via a callback registered on `window`, driven from
Rust rather than a zone.js-patched JS task, so a handler wired up the obvious
way runs **outside** Angular's zone and never triggers change detection.
`tauri.service.ts` re-enters the zone around every listener callback and every
command result — that's the only reason it's safe to call `invoke`/`listen`
from anywhere else in the app.

A rejected command resolves to `{ kind, message }` with `kind` one of
`badRequest` / `notFound` / `conflict` / `internal` (`src-tauri/src/error.rs`'s
`AppError`). Show the first three to the operator as actionable warnings;
treat `internal` as a fault.

# Tauri invoke / emit

- Command names: `entity_action` in `snake_case` on the Rust side — `auth_login`, `user_get_list`.
- Keep a single registry of command name strings on the Angular side, `core/tauri/tauri-commands.const.ts`, and reference it everywhere instead of hardcoding strings.
- Same pattern for events: registry at `core/tauri/tauri-events.const.ts`.
- One command per action. Don't multiplex several operations behind one command with a type/action flag.
- Every new command needs an entry in the relevant Tauri v2 capabilities allowlist (`src-tauri/capabilities/*.json`) — add this in the same change, not a follow-up, or the command will be silently denied at runtime.
- Event payloads are typed `response*` models, never `any`.