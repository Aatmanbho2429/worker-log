---
paths:
  - "web/src/app/services/**/*.ts"
  - "web/src/app/core/**/*.ts"
---

# NgZone wrapper

`web/src/app/core/zone-wrapper/zone-wrapper.service.ts` (`ZoneWrapperService`)
is the **only** file in the app allowed to import `@tauri-apps/api` or touch
`invoke`/`listen`. Every service method that talks to Tauri calls
`zoneWrapper.invoke()` / `zoneWrapper.listen()`.

Why: Tauri delivers results and events through a callback registered on
`window`, driven from Rust rather than from a zone.js-patched JS task, so a
handler wired up the obvious way runs **outside** Angular's zone and never
triggers change detection. `ZoneWrapperService` re-enters the zone around
every listener callback and every command result — that is the only reason it
is safe for the rest of the app to treat Tauri calls like ordinary promises.

It also unwraps the `ApiResponse` envelope, so callers never see it: a 2xx
resolves with `data`, anything else throws `{ kind, message }` with `kind` one
of `badRequest` / `notFound` / `conflict` / `internal` (the inverse
status→kind mapping lives in `zone-wrapper.service.ts`; the forward one is
`AppError::status_code()` in `src-tauri/src/error.rs`). Show the first three
to the operator as actionable warnings — `notify.service.ts`'s `fromCommand()`
already does — and treat `internal` as a fault.

The account layer reaches the bridge the same way, one file deep:
`core/tauri-auth.backend.ts` is the only part of it that touches
`ZoneWrapperService`, and `auth.service.ts` goes through that.
