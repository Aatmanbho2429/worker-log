---
name: supabase
description: The account/licensing backend (separate from the local SQLite waste-log data). Use when touching auth.rs, supabase.rs, anything under supabase/, or the account/profile/subscription screens — registration, login, password reset/change, licence-to-device binding, subscription plans, Razorpay payments, or the payment-history view.
---

# Supabase: accounts & licensing

A **second, unrelated database** — real user accounts, subscription status and
payment history — bolted onto an otherwise offline, single-SQLite-file app.
Waste-log data (`worker`, `series_of_product`, `worker_log`, …) never touches
Supabase; see `.claude/rules/data-model.md` for that half. This skill covers
the account layer and the login / register / profile screens only.

## Where it lives

Nothing about Supabase lives in `web/`. The project URL, anon key, session
tokens and the licence check are all in `src-tauri/src/auth.rs` (the twelve
`auth_*` commands, in the same `<name>_impl` + thin-wrapper shape as
`commands.rs`) and `src-tauri/src/supabase.rs` (the HTTP transport).

`supabase/` is the server side, and is *sources only* — nothing in this repo
deploys them. It holds `README.md`, `config.toml`, three migrations
(`0001_account_schema.sql`, `0002_email_otps.sql`, `0003_payments.sql`) and
eight edge functions: `register`, `login`, `validate-token`,
`forgot-password`, `send-otp`, `get-plans`, `create-order`, `verify-payment`.
Each is a single self-contained file with no shared imports, so it can be
pasted into the dashboard as-is. What is actually **live** is not inferable
from this tree — see "Deployment status is not in the repo" below.

`supabase/README.md` is kept in step with `config.toml` whenever a function is
added and had no known drift at last check.

## Transport: which calls go through a function

Anything needing the service role key goes through an edge function via
`supabase::call_function`; the rest uses PostgREST with the anon key. Three
things depart from that and each departure is deliberate:

- **`auth_payments`** — the payment-history table on the profile — reads
  `subscriptions` over PostgREST with the **operator's own access token**,
  leaning on row level security to return only their rows. It is the one
  table read that uses a user token. `.claude/plans/payment-history.md` plans
  to move it onto a `get-user-subscriptions` function; that has not been done.
- **`get-plans`** takes no token at all and is callable signed in or not,
  because the operator it exists for is precisely the one whose token may be
  mid-refresh.
- **`create-order` and `verify-payment`** carry the operator's `accessToken`
  in the request *body* rather than an `Authorization` header
  (`supabase::call_function` always sets that header to the bare anon key) and
  check it themselves with `auth.getUser()` — the same pattern
  `validate-token` already uses.

## Sign-in, registration, and the device binding

Signing in goes through the `login` **function**, not GoTrue directly, because
the device-binding check (and claiming an unbound licence) needs the service
role key. `auth.rs`'s own `sign_in` survives only for `auth_change_password`,
which just re-proves a password.

Registering is two steps: `auth_send_otp` mails a 4-digit code (rate-limited
per address inside the function, hashed with a pepper into `email_otps`, never
stored in the clear), then `auth_register` verifies it and creates the account
in one call. Nothing is written until the code checks out.

A licence is bound to one PC by a device fingerprint taken at registration —
or claimed by the first machine to sign in, for a row left unbound — and
re-checked at every sign-in and again every six hours while the window stays
open (`AuthService.validate()`'s timer → `auth_validate` → `validate-token`).
So a subscription lapsing, or a device unbound from the dashboard, is noticed
without the operator restarting the app.

## What an expired subscription does

A lapsed subscription does **not** stop the account signing in — only `status`
(active / inactive / blocked) and the device binding gate that. It stops
everything past the profile screen instead:

- `authGuard` (`core/auth.guard.ts`) redirects every other route to the
  profile once `AuthService.subscriptionExpired()` is true.
- The shell hides the Floor and Masters nav sections for the same reason
  (`shell.ts`'s `visibleSections`), so nothing is left to click that would
  only bounce back.

## Renewal: plans → Razorpay → unblocked

1. The profile shows the renewal catalogue in a dialog (`auth_plans` →
   `get-plans`), fetched only while the subscription reads `expired` or
   `expiring`. It auto-opens once per session the first time that becomes
   true, and reopens afterwards from a "View plans" button on the
   subscription card.
2. `Profile.selectPlan` opens Razorpay's checkout widget through
   `RazorpayService` (`core/razorpay.service.ts`) — the one file in `web/`
   that reaches a third-party host directly, and deliberately so: a card form
   needs a browser context Rust does not have.
3. What the widget reports goes to `auth_verify_payment` → `verify-payment`,
   which recomputes the payment's HMAC signature server-side before recording
   it. Nothing the widget says is trusted until then.
4. `auth_verify_payment` answers with a freshly rebuilt `Session`;
   `AuthService.verifyPayment` replaces the session signal with it, which is
   what clears `subscriptionExpired()` and brings the nav back without a
   reload.

`tauri.conf.json`'s `security.csp` is scoped to `razorpay.com` hosts so the
checkout script loads at all — the default `script-src 'self'` this app
otherwise runs under would refuse it silently. Its `connect-src` line
deliberately keeps Tauri's own `ipc:` / `http://ipc.localhost` origins
alongside the Razorpay ones, because writing an explicit `connect-src`
*replaces* rather than extends the implicit `default-src 'self'` every other
command was reaching `invoke` through.

## The design notes in `.claude/plans/`

Five notes, all for this layer, each written before its work and each carrying
reasoning the code only implies (why the OTP is peppered, why `login` moved off
GoTrue, why the payment signature is recomputed server-side). Read the relevant
one before changing `auth.rs`, `supabase.rs` or anything under
`supabase/functions/`.

| Plan | Covers | State of the code |
| --- | --- | --- |
| `otp-registration.md` | the two-step register flow | in the tree |
| `token-validation.md` | sign-in + the six-hourly re-check | in the tree |
| `subscription-plans.md` | `auth_plans`/`get-plans`, locking the app while expired | in the tree |
| `razorpay-payments.md` | checkout, `create-order`/`verify-payment`, unblocking on payment | in the tree |
| `payment-history.md` | moving `auth_payments` off PostgREST onto `get-user-subscriptions` | **not written — planned only** |

### Deployment status is not in the repo

Every plan's **Status** header is frozen at the moment it was written, and all
four implemented ones still read "code complete … not yet deployed". Nothing
here pushes an edge function, so those lines record intent, not the dashboard.
Ask, or check the dashboard, before concluding a function is or isn't live.

## Why this layer sits in `core/`, not `services/`

`scaffold-entity` step 2 asks for a Tauri-calling service per entity under
`services/`, and series/reason/grade/worker/waste/barcode/settings/export all
follow it. `auth.service.ts`, `auth.backend.ts` and `tauri-auth.backend.ts`
were deliberately left in `core/`: the layer was already compliant with
`.claude/rules/zone-wrapper.md` before that split happened (only
`tauri-auth.backend.ts` touches `ZoneWrapperService`, exactly as the rule
asks), and it is its own documented mini-layer rather than a CRUD entity in
the sense the rest of `services/` is. This is not a rule violation — say so if
a change wants it moved for consistency anyway.
