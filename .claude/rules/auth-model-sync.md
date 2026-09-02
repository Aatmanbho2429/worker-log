---
paths:
  - "src-tauri/src/auth.rs"
  - "web/src/app/models/auth*.ts"
---

# Keep the auth DTOs in lockstep

`web/src/app/models/auth.ts` and `auth.requests.ts` mirror the `#[derive(Serialize)]`
/ `#[derive(Deserialize)]` structs in `src-tauri/src/auth.rs`
(`UserAccount`, `Subscription`, `Payment`, `Session`, `RegisterRequest`,
`LoginRequest`, `ChangePasswordRequest`) field-for-field, camelCase both sides.
Changing a field on either side without changing the other silently breaks
that field across the IPC boundary — Tauri won't type-check it for you.

Never invent a field on the TS side that Rust doesn't send, and never add a
secret, token, or Supabase URL/key to any of these models — the window is
handed a `Session`, never credentials (see `auth.rs`'s module doc and
`supabase/README.md`).
