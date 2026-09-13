---
paths:
  - "web/src/app/models/response/**/*.ts"
  - "src-tauri/src/models/response/**/*.rs"
  - "src-tauri/src/commands.rs"
  - "src-tauri/src/auth.rs"
---

# API response envelope

Every command answers with the same shape — success or failure — rather than
rejecting the `invoke` promise:

```ts
export interface apiResponse<T> {
  statusCode: number;
  message: string;
  data: T;
}
```

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse<T> {
    pub status_code: u16,
    pub message: String,
    pub data: T,
}
```

## How a command is written

The real logic lives in a `<name>_impl` function returning the ordinary
`AppResult<T>`, so it can use `?` throughout. The `#[tauri::command]` wrapper
is one line that calls it and converts with `.into()`:

```rust
async fn auth_payments_impl(app: AppHandle) -> AppResult<Vec<Payment>> { … }

#[tauri::command]
pub async fn auth_payments(app: AppHandle) -> ApiResponse<Vec<Payment>> {
    auth_payments_impl(app).await.into()
}
```

- Commands never `panic!` or return a raw error string. The conversion goes
  through `AppError::status_code()` in `src-tauri/src/error.rs` — 400 / 404 /
  409 / 500.
- `ZoneWrapperService.invoke()` unwraps `.data` once on the way back, so
  services and components only ever see the plain payload type, never the
  envelope. See `.claude/rules/zone-wrapper.md`.
