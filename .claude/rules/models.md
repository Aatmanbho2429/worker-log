---
paths:
  - "src-tauri/src/models/**/*.rs"
  - "web/src/app/models/**/*.ts"
---

# Models

## TypeScript (`web/src/app/models/`)
- Requests live in `models/request/`, responses in `models/response/`.
- File and exported type names are camelCase, suffixed with `request` or `response` — e.g. `loginRequest.ts`, `loginResponse.ts`.
- Model fields are camelCase.

## Rust (`src-tauri/src/models/`)
- Same split: `models/request/`, `models/response/`.
- File and struct names follow idiomatic Rust convention — `snake_case` file, `PascalCase` struct — e.g. `login_request.rs` → `struct LoginRequest`.
- Annotate every struct with `#[serde(rename_all = "camelCase")]` so JSON crossing the IPC boundary matches the TS field names exactly.

## Keep the two trees mirrored
Every TS model has a same-named Rust counterpart: `loginRequest.ts` ↔ `login_request.rs`. When adding, renaming, or changing fields on one, update the other in the same change — nothing enforces this automatically.

## Flat re-exports
Both trees re-export their halves flatly — `web/src/app/models/index.ts` and
`src-tauri/src/models/mod.rs` — so the rest of each side keeps writing
`import { Grade } from '../../models'` and `crate::models::Grade` without
knowing which subfolder a type sits in.

## Where the rule is not retrofitted
The `*Request` suffix above is followed by the **account** domain
(`loginRequest.ts` ↔ `login_request.rs`). The **waste** domain predates the
rule and pairs `seriesPayload.ts` ↔ `series_upsert.rs` — likewise
grade/reason/worker, and `rangeFilter.ts` ↔ `range_query.rs`. The two trees
still pair one-for-one; only the name differs. Match the neighbours of
whatever you are adding rather than renaming the existing set.

## Files in `models/` that are not models
- `auth.ts` — the account domain's status unions plus every display and
  validation helper, re-exporting the response structs it works with.
  `auth.requests.ts` re-exports the `auth_*` commands' request/response types
  the same way.
- `constants.ts` — non-copy literals used in more than one place (route paths,
  toast lifetimes). User-facing copy goes to `assets/i18n/en.json` instead —
  see the `extract-static-text` skill.
- `events.ts` — `DataChanged`, mirroring `src-tauri/src/events.rs`. It sits
  outside the request/response split because a pushed event is neither.
