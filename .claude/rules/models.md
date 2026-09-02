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