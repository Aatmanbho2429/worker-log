# OTP email verification on register

**Status: code complete (Rust + Angular + Supabase function/migration files).
Not yet deployed** — see "Still needed from you" at the bottom.

Register becomes two steps: submit details → `send-otp` mails a 4-digit code →
operator enters it → `register` verifies the code and creates the account in
one call. Nothing is written to Supabase until the code checks out.

## Supabase (done, not yet deployed)

- `supabase/migrations/0002_email_otps.sql` — `email_otps` table, RLS on, no
  policies (every read/write goes through the service role key in an edge
  function, same as `users`/`subscriptions`/`plans`).
- `supabase/functions/send-otp/index.ts` — new. Rejects an already-registered
  address, enforces 60s cooldown + 5/hour, writes the hashed code before
  mailing via Resend, returns `{ retryAfterSeconds }`.
- `supabase/functions/register/index.ts` — modified. OTP check inserted after
  the device-id check, before `createUser`, so a wrong code leaves nothing to
  clean up. Row deleted on expiry/exhaustion (forces a fresh send) or after a
  successful account write (not before — a rolled-back insert must not strand
  the operator behind a cooldown).
- `supabase/config.toml` — `[functions.send-otp] verify_jwt = false`.

Deploy actions outside this repo (require MCP auth or manual dashboard/CLI):

1. Apply `0002_email_otps.sql` to `ujalkizozxeshrheuhkb`.
2. `supabase secrets set OTP_PEPPER=<long random string>`.
3. Confirm `RESEND_API_KEY` is set on `ujalkizozxeshrheuhkb` (not just the
   other, unrelated Pictoria project).
4. Deploy `send-otp` and `register`, Verify JWT off on both.

## Rust (`src-tauri/src`)

1. `models/response/otp_sent.rs` (new) — `OtpSent { retry_after_seconds: u32 }`,
   `#[serde(rename_all = "camelCase")]`.
2. `models/response/mod.rs` — declare + re-export `OtpSent`.
3. `models/request/register_request.rs` — add `pub otp_code: String`.
4. `auth.rs` — `auth_send_otp_impl(email: String) -> AppResult<OtpSent>` calling
   `supabase::call_function("send-otp", &json!({ "email": ... }), "Could not
   send the code.")`, modeled on `auth_forgot_password_impl`; thin
   `#[tauri::command]` wrapper.
5. `auth.rs` — `auth_register_impl` sends `"otpCode": payload.otp_code` in the
   body to the `register` function.
6. `lib.rs` — add `auth::auth_send_otp` to `generate_handler![]`. Nothing goes
   in `capabilities/default.json` (app commands aren't listed there — see
   CLAUDE.md).

## Angular (`web/src/app`)

7. `models/response/otpSent.ts` (new) — `{ retryAfterSeconds: number }`.
8. `models/response/index.ts` — re-export.
9. `models/request/registerRequest.ts` — add `otpCode: string`.
10. `models/auth.requests.ts` — re-export `OtpSent`.
11. `core/tauri/tauri-commands.const.ts` — `authSendOtp: 'auth_send_otp'`.
12. `core/auth.backend.ts` — `abstract sendOtp(email: string): Promise<OtpSent>`.
13. `core/tauri-auth.backend.ts` — one-line impl, same shape as `forgotPassword`.
14. `core/auth.service.ts` — passthrough `sendOtp`, no session mutation.
15. `models/auth.ts` — `otpProblem(code: string)`: required, exactly 4 digits.
16. `views/auth/register/register.ts` — two-step flow:
    - `step` signal (`'details' | 'code'`), `otpCode`, `otpTouched`,
      `otpProblem` computed, `cooldown` signal ticked via interval (cleared in
      `ngOnDestroy`).
    - `requestCode()` replaces `submit()`'s body for step 1: validate, call
      `auth.sendOtp(email)`, start cooldown from `retryAfterSeconds`, advance
      to `'code'`.
    - `confirm()`: call `auth.register({ ...form, otpCode })`, existing
      welcome toast + navigation.
    - `resend()`: `requestCode()` again, gated on `cooldown() === 0`.
    - `backToDetails()`: back to step 1, clears `otpCode` (a code is bound to
      the address it was sent to).
17. `views/auth/register/register.html` — existing fieldset wrapped in
    `@if (step() === 'details')`; `@else` block with the 4-digit input, the
    address confirmation, resend (disabled + counting down during cooldown),
    back link, confirm button.
18. `assets/i18n/en.json` — `auth.register.{codeTitle,codeSubtitle,codeSubmit,
    resend,resendIn,back,codeSent}`, `validation.{otpRequired,otpLength}`.

## Verify

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cd web && npm test -- --watch=false && npx ng build
npx prettier --write src/app/...   # web/ only — supabase/ isn't prettier-managed
```

Untestable end-to-end until Supabase deploy steps above are done — code will
compile and unit-test green before that, but a real registration attempt fails
at `send-otp` until `OTP_PEPPER` exists and both functions are deployed.

## Decisions, so they don't get re-litigated mid-build

- 4-digit code, safe only because of the 5-attempt cap in `register` — do not
  raise `MAX_ATTEMPTS` without widening the code.
- Resend cooldown is server-driven (`retryAfterSeconds`), not a client
  constant.
- Email address is locked once step 2 is reached.
- Going back to step 1 invalidates the entered code (cleared client-side; the
  row itself is only replaced by the next `send-otp` call).
- Angular never calls the function URL directly — always
  `AuthService → AuthBackend → Tauri → Rust → edge function`.

## Still needed from you

Code is written and verified locally (`cargo build`, `cargo test`, `ng build`,
`npm test` all green — 32 Rust tests, 37 Angular tests). None of it can run
end to end until:

1. `/mcp` → authenticate `supabase` (still showing "Needs authentication" as
   of this write-up), or apply the two steps below by hand.
2. Apply `supabase/migrations/0002_email_otps.sql` to `ujalkizozxeshrheuhkb`.
3. `supabase secrets set OTP_PEPPER=<long random string>` on that project.
4. Confirm `RESEND_API_KEY` is set on `ujalkizozxeshrheuhkb` (not the other
   Pictoria project).
5. Deploy `send-otp` and `register`, Verify JWT off on both.
