# Registration and forgotten passwords: the OTP flows

Covers `supabase/functions/send-otp`, `supabase/functions/register`,
`supabase/migrations/0002_email_otps.sql`, `auth_send_otp` / `auth_register`
in `auth.rs`, and `views/auth/register/` — plus, below, the forgot-password
flow that reuses the same OTP machinery: `supabase/functions/forgot-password-send-otp`,
`supabase/functions/forgot-password-verify-otp`,
`supabase/migrations/0005_password_reset_otps.sql`,
`auth_forgot_password_send_otp` / `auth_forgot_password_verify` in `auth.rs`,
and the forgot-password dialog in `views/auth/login/`.

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

## Forgot password

The login screen's "Forgot password?" dialog, in three steps: an email
address, a 4-digit code, then a mailed password. Two functions, structurally
copies of `send-otp` and the register-verification half of `register`, pointed
at their own table, `password_reset_otps`, rather than `email_otps` — kept
separate so this flow's cooldowns and attempt counters can never tie into
registration's, and so a reset code is never something `register`'s check
could see.

There used to be a single `forgot-password` function that reset a password
immediately on nothing but an email address — no proof of anything. It was
never deployed, and was replaced rather than fixed once the OTP step was
added; it no longer exists in this tree.

**`forgot-password-send-otp`** — checks the address before mailing anything,
refusing in this order: no account for the address, the account blocked, the
account not active, or the account licensed to a different PC. On all four
passing, mails a 4-digit code (same rate limit as `send-otp`: one a minute,
five an hour, ten-minute expiry, same `OTP_PEPPER` hash).

**`forgot-password-verify-otp`** — checks the code (same shape as
`register`'s: expiry, 5 attempts, deleted on either dead end), then **re-runs
the same four account checks**, because ten minutes is long enough for an
account to be blocked or a licence moved in between. Only then does it roll a
password, **mail it, and set it in that order** — the reverse of the deleted
function, and deliberately so: mailing first means a failed
`updateUserById` afterwards leaves the *old* password still working, with the
row kept so the same code can be retried (it just mails a different
password). A failed mail changes nothing at all. The `password_reset_otps`
row is only deleted once the password is actually set.

The generated password: 12 characters from `send-otp`'s
look-alike-free alphabet (no `0`/`O`/`1`/`l`), no symbols (it's read off an
email and typed by hand), drawn with rejection sampling to avoid the small
modulo bias a plain `byte % length` would carry, and **regenerated until it
contains at least one letter and one digit** — the app's own password rule
(`passwordProblem()`) should never reject a password the app itself issued.

**Account enumeration is accepted here, on purpose.** "No account is
registered with that email address" and "licensed to a different PC" both
tell whoever types an address something about it. This is a licensed tool
with a known operator at a known machine; a clear message is worth more here
than the enumeration it costs — the same trade the deleted `forgot-password`
already made, and the same one `validate-token`'s messages make once someone
is signed in.

**A null `device_id` is allowed, not refused**, in both functions — unlike
`validate-token`, which refuses one. A null means support released the
licence so it can move; refusing a reset here would strand exactly the
operator support just helped. It is claimed at the next sign-in, same as an
unclaimed registration.

**No password rules are enforced server-side** — the email's shape and the
code's shape are both checked in the dialog (`emailProblem()` / `otpProblem()`);
the functions only check that their fields are present.

**Sessions are not revoked.** Unlike `change-password`, which can call
`auth.admin.signOut(jwt, 'global')` because it holds the caller's token,
nobody is signed in during a password reset, and supabase-js has no
sign-out-by-user-id. Any session an attacker already held elsewhere survives
until its refresh token next meets a device check. Known and accepted, not
built around.

The dialog itself lives in `views/auth/login/login.ts` / `.html`, sharing its
OTP input styling (`.otp-field`, `.otp-field__input`) with the register
screen's code step — both pull those classes from the shared
`assets/styles/components/_otp-field.scss` (plus `_password-meter.scss` for
the strength meter and the `_auth-card.scss` / `_auth-layout.scss` /
`_auth-brand.scss` partials for the surrounding chrome) rather than each
having its own copy.

## Email

Sender is `Waste Log <noreply@pictoria.shop>`, hard-coded at the top of each
mailing function — the same verified domain Pictoria sends from. The mailbox
need not exist; the domain must be verified in Resend.
