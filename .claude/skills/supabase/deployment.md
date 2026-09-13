# Deploying, secrets, and what is live

Nothing in this repo deploys to Supabase. The user pastes each function into
the dashboard (or uses the CLI) and runs migrations in the SQL editor. So
**what is in `supabase/` and what is live can differ** — check before assuming.
The Supabase MCP connector can read the live project by ref
(`ujalkizozxeshrheuhkb`) even though it does not appear in its project list.

## Live state — last checked 2026-09-13

Update this section whenever you check again or the user deploys something.

| Piece | Live? |
| --- | --- |
| `register`, `send-otp`, `login`, `validate-token`, `get-plans`, `create-order`, `verify-payment`, `get-user-subscriptions` | ✅ deployed (`login`/`validate-token` v4 and `verify-payment` v2 carry the `current_subscription_id` change) |
| `change-password` | ✅ deployed (v1, confirmed 2026-09-13) |
| `forgot-password-send-otp`, `forgot-password-verify-otp` | ❌ **not deployed as of this write-up** — `auth_forgot_password_send_otp` / `_verify` fail until they are. The old `forgot-password` they replace was never deployed either, so there is nothing to remove from the dashboard |
| `0002_email_otps.sql` | ✅ `email_otps` exists |
| `0003_payments.sql` | ⚠️ **half applied** — `subscriptions.razorpay_signature` exists, but the partial unique index `subscriptions_razorpay_payment_id_key` does **not**. `verify-payment`'s replay check still works; only the race backstop is missing |
| `0004_current_subscription.sql` | ✅ column, FK and backfill applied |
| `0005_password_reset_otps.sql` | ❌ **not deployed as of this write-up** |
| RLS policies | none on any public table — intended, see [payments.md](payments.md#rls-deny-all-is-deliberate) |
| `public.plans` | 4 active rows |
| Razorpay keys | set as `RAZORPAY_KEY_ID_PROD` / `RAZORPAY_KEY_SECRET_PROD`; **test vs live mode unverified** |

To re-check: list edge functions, and query `pg_policies`,
`information_schema.columns` and `pg_indexes` read-only.

## Deploying a function

- Paste the whole `index.ts` into the dashboard. Each file is self-contained on
  purpose; never add a shared import.
- **Verify JWT off** on every function (CLI reads `config.toml`, which already
  sets `verify_jwt = false` for all eleven; the dashboard does not read it).
- CLI alternative:
  `supabase functions deploy <name> --project-ref ujalkizozxeshrheuhkb`.
- Add a new function to `config.toml` and to `supabase/README.md`'s table in
  the same change.

## Secrets

Platform-injected, nothing to set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

| Secret | Used by |
| --- | --- |
| `RESEND_API_KEY` | `register`, `send-otp`, `change-password`, `forgot-password-send-otp`, `forgot-password-verify-otp` — must be set on **this** project, not the unrelated Pictoria one |
| `OTP_PEPPER` | `send-otp`, `register`, `forgot-password-send-otp`, `forgot-password-verify-otp` (a long random string; changing it invalidates outstanding codes) |
| `RAZORPAY_KEY_ID_PROD`, `RAZORPAY_KEY_SECRET_PROD` | `create-order`, `verify-payment` |

No function needs `RESEND_FROM` any more — the old `forgot-password` was the
only one that did, and it no longer exists.

The `_PROD` suffix was inherited from Visara and says nothing about the mode.
Test keys start `rzp_test_`, live `rzp_live_`. Check before any test payment —
a live key charges a real card. Razorpay's test card
`4111 1111 1111 1111` is declined in live mode, which is one way to tell.

## Ordering rules that have bitten or nearly bitten

- **Migration before function** when a function selects a new column or
  embed. `login` selecting `current_subscription_id` before `0004` ran would
  have locked every account out. Old app + new function is fine (extra fields
  are ignored); new app + old function is fine (`#[serde(default)]`).
- **After a CSP edit, test an ordinary Tauri command first** — a bad
  `connect-src` breaks all IPC. See [payments.md](payments.md).
- **Deploy `change-password` before shipping an app build that calls it.** An
  old app build is unaffected either way (it never calls the function); a new
  build against a project without it gets "Could not change the password.
  (the server has no such endpoint yet)" from the profile dialog.
- **Run `0005_password_reset_otps.sql` before deploying the two
  `forgot-password-*` functions.** Both write to the table on the very first
  call; deploying them first just means the first reset attempt after that
  fails with a database error instead of a "no such endpoint" one — less
  clear, but not destructive either way. Deploy order between the two
  functions themselves doesn't matter to each other.

## Manual test recipes

No automated test reaches Supabase; these are the passes that have been used.

- **Expiry:** set `users.subscriptions_end_date` to yesterday in the dashboard,
  restart the app (or wait for the six-hourly tick). Expect `subscription_status`
  written to `expired`, redirect to `/profile`, Floor and Masters gone from the
  nav, the plans dialog auto-opening once, and `/waste` by URL bouncing back.
  Set it a week out: `expiring`, warning banner, nav restored, no second
  auto-open that session.
- **Payment:** with test keys, pay with `4111 1111 1111 1111`. Expect the
  dialog to close, a toast, the card showing the new plan and date, the nav
  back **without a reload**, and a new payment-history row. Check exactly one
  new `subscriptions` row and `users.current_subscription_id` pointing at it.
- **Replay:** call `verify-payment` again with the same three `razorpay_*`
  values. Expect no new row and no extension.
- **Dismiss:** close checkout mid-payment. Expect no toast and no row.
- **Change password:** try a wrong current password ("The current password is
  not right." — dialog stays open, still signed in, no email). Then a correct
  one: dialog closes, toast, lands on `/login`, `session.json` gone. Sign in
  with the old password (refused), then the new one (works). The confirmation
  email should arrive, and `select count(*) from auth.sessions where user_id
  = '<id>'` should read `0` right after the change, before signing back in.
- **Register:** needs `OTP_PEPPER` and `RESEND_API_KEY` set; a real attempt
  fails at `send-otp` without them.
- **Forgot password:** an unknown address → "No account is registered with
  that email address.", still on the email step, no mail. A blocked or
  inactive test account → the matching message. A device mismatch
  (`update public.users set device_id = 'other'` on a test row) → the
  different-PC message; set it back to `null` and a code sends (the null-device
  rule). Correct address → code arrives, dialog moves to the code step with a
  60s countdown. Five wrong codes → "Too many incorrect codes", row deleted.
  Correct code → the done step, new-password mail arrives, the old password
  is refused at sign-in and the mailed one works, and the
  `password_reset_otps` row for the address is gone.
