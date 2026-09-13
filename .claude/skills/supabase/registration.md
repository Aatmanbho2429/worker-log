# Registration: the two-step OTP flow

Covers `supabase/functions/send-otp`, `supabase/functions/register`,
`supabase/migrations/0002_email_otps.sql`, `auth_send_otp` / `auth_register`
in `auth.rs`, and `views/auth/register/`.

## The flow

1. The operator fills in their details. `auth_send_otp` → `send-otp` mails a
   4-digit code and answers `{ retryAfterSeconds }`.
2. The operator types the code. `auth_register` → `register` verifies it and
   creates the account in the same call.

**Nothing is written to Supabase until the code checks out.** `register` does
not sign in — the register screen sends the operator to the login screen, so
"an account exists" and "this window is signed in" stay separate facts.
`auth_login` is the only command that writes `session.json`.

## `send-otp`

- Refuses an address that already has an account.
- Rate limit, enforced in the function: **one code a minute, five an hour**
  per address (`COOLDOWN_MS`, `MAX_PER_HOUR`). This is `send-otp`'s only
  protection — it mails anyone who asks.
- A code is good for **ten minutes** (`CODE_TTL_MS`).
- Writes the **hashed** code to `email_otps` *before* mailing it, then sends
  via Resend.
- The code is hashed with a server-side pepper (`OTP_PEPPER` secret) and is
  never stored in the clear. A leaked `email_otps` table is not a list of
  working codes.

## `register`

Order of checks, and why each is where it is:

1. **This PC is not already registered** — one machine carries one account;
   that *is* the licence. Only the server can check it: the client would have
   to read every other account's `device_id`.
2. **The OTP**, checked after the device check and **before** `createUser`, so
   a wrong code leaves nothing to clean up.
3. Create the auth user, then the `public.users` row keyed to it (14-day
   `trial` on `users`, this PC's `device_id`). `public.users.id` is a foreign
   key onto `auth.users.id`, so the profile insert can only come second — and
   if it fails, **the auth user is deleted again**. An auth user with no
   profile could sign in, find nothing about itself, and hold an email address
   that can never be registered again.
4. Send the welcome email.

The `email_otps` row is deleted on expiry or when attempts run out (forcing a
fresh send), or **after** a successful account write — not before, because a
rolled-back insert must not strand the operator behind the resend cooldown.

Field validation (phone format, password strength) is deliberately **not** in
the function. The register form is the one place those rules live; the
function stores the body as given. See the user's standing preference: form
rules in the UI only, no server-side copy.

## Decisions — don't re-litigate these

- **A 4-digit code is only safe because of the 5-attempt cap** in `register`.
  Do not raise `MAX_ATTEMPTS` without widening the code.
- **The resend cooldown is server-driven** (`retryAfterSeconds`), never a
  client constant.
- **The email address is locked** once step 2 is reached — a code is bound to
  the address it was sent to.
- **Going back to step 1 clears the entered code** client-side. The row itself
  is only replaced by the next `send-otp` call.
- **Angular never calls a function URL.** Always `AuthService → AuthBackend →
  Tauri → Rust → edge function`.

## `forgot-password`

Rolls a new password, emails it via Resend, then sets it — never returns it.
Unlike `register` and `send-otp`, which hard-code `SENDER`, it **requires**
`RESEND_FROM` as well as `RESEND_API_KEY` and throws if either is missing. **Not deployed as
of the last check** — see [deployment.md](deployment.md).

## Email

Sender is `Waste Log <noreply@pictoria.shop>`, hard-coded at the top of each
mailing function — the same verified domain Pictoria sends from. The mailbox
need not exist; the domain must be verified in Resend.
