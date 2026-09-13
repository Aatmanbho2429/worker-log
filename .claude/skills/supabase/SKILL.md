---
name: supabase
description: The account/licensing backend (separate from the local SQLite waste-log data). Use when touching auth.rs, supabase.rs, anything under supabase/, or the account/profile/subscription screens — registration, login, password reset/change, licence-to-device binding, subscription plans, Razorpay payments, the payment-history view, or deploying an edge function.
---

# Supabase: accounts & licensing

A **second, unrelated database** — real user accounts, subscription status and
payment history — bolted onto an otherwise offline, single-SQLite-file app.
Waste-log data (`worker`, `series_of_product`, `worker_log`, …) never touches
Supabase; see `.claude/rules/data-model.md` for that half. This skill covers
the account layer and the login / register / profile screens only.

## Read the reference file for what you are changing

This file is the overview. The reasoning behind each piece — the decisions,
the options rejected, the traps already hit — is in the files beside it. Read
the matching one **before** changing that area; most of what is in them is
not recoverable from the code.

| File | Read before touching |
| --- | --- |
| [registration.md](registration.md) | `send-otp`, `register`, the two-step register screen, `email_otps` |
| [sessions.md](sessions.md) | `login`, `validate-token`, `validated_session`, the six-hourly check, the device binding, what an expired subscription blocks, change password |
| [payments.md](payments.md) | `get-plans`, the plans dialog, Razorpay, `create-order`, `verify-payment`, `get-user-subscriptions`, `users.current_subscription_id`, the subscription card, the CSP |
| [deployment.md](deployment.md) | deploying anything, secrets, migrations, **what is actually live**, manual test recipes |

## Where it lives

Nothing about Supabase lives in `web/`. The project URL, anon key, session
tokens and the licence check are all in `src-tauri/src/auth.rs` (the twelve
`auth_*` commands, in the same `<name>_impl` + thin-wrapper shape as
`commands.rs`) and `src-tauri/src/supabase.rs` (the HTTP transport). Project:
`ujalkizozxeshrheuhkb`.

`supabase/` is the server side, and is *sources only* — nothing in this repo
deploys them. It holds `README.md`, `config.toml`, four migrations
(`0001_account_schema.sql` … `0004_current_subscription.sql`) and ten edge
functions: `register`, `login`, `validate-token`, `forgot-password`,
`send-otp`, `get-plans`, `create-order`, `verify-payment`,
`get-user-subscriptions`, `change-password`. Each is a single self-contained
file with no shared imports, so it can be pasted into the dashboard as-is —
which is why helpers such as `withCurrentSubscriptionStatus` and
`PROFILE_COLUMNS` are deliberately **duplicated** across files rather than
shared. What is live is not inferable from this tree;
[deployment.md](deployment.md) records the last check.

## Transport: nothing reads a table directly

Every command goes through either **GoTrue** (refreshing a stale access
token — the only thing left that needs no more than the anon key) or an
**edge function** via `supabase::call_function` (anything needing the service
role key, which by now is everything else — signing in, changing a password,
and the rest). There is no PostgREST path: `supabase::select` was deleted once
its last callers moved behind functions.

- **Row level security is enabled on every table with no policy at all**, so
  the anon key plus a user token reads nothing directly. `0001` writes
  select-only policies, but they were never run live — and they are now
  deliberately left un-run. Why, and how this was discovered, is in
  [payments.md](payments.md#rls-deny-all-is-deliberate).
- **Edge functions carry the caller's `accessToken` in the request body**, not
  an `Authorization` header — `supabase::call_function` always sets that header
  to the bare anon key — and resolve the caller with `auth.getUser()`. A
  function must **never** trust a `user_id` from the body: the reference
  implementations these were ported from did, and would have handed any
  guessed uuid someone else's data.
- **`get-plans`** is the one function taking no token at all.
- **Every function answers `{ error: { kind, message } }`** on refusal —
  `supabase.rs`'s `to_error()` branches on `kind`
  (`notFound`/`badRequest`/`conflict`/`forbidden`/`internal`). A
  `{ success: false }` envelope, which every reference used, reaches the
  operator as a generic 500 with the real message swallowed.
- **Verify JWT is off on every function.** They are called before anybody is
  signed in, or check the token themselves.

## The flows, in one paragraph each

**Registering** is two calls: `send-otp` mails a 4-digit code, then `register`
verifies it and creates the account. Nothing is written until the code checks
out. → [registration.md](registration.md)

**Signing in** goes through the `login` function (not GoTrue directly) because
the device binding needs the service role key. A licence is bound to one PC; a
null `device_id` is claimed by the first machine to sign in. `validate-token`
re-checks the stored session at launch and every six hours.
→ [sessions.md](sessions.md)

**An expired subscription still signs in** — only account `status` and the
device binding refuse. Expiry instead locks every screen except the profile
(`authGuard`) and hides the Floor and Masters nav (`shell.ts`'s
`visibleSections`). → [sessions.md](sessions.md)

**Renewing:** the profile shows plans (`get-plans`) while `expired`/`expiring`;
picking one opens Razorpay's checkout in the webview; `verify-payment`
recomputes the signature server-side, records the term, points
`users.current_subscription_id` at it, and the app rebuilds its session so the
nav comes back without a reload. → [payments.md](payments.md)

**Changing a password** (`change-password`, from the profile dialog) proves
the current one, sets the new one, revokes every session for the account, and
mails a confirmation — the app then signs itself out and returns to `/login`.
→ [sessions.md](sessions.md)

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

## Planning new account work

Write a design note in `.claude/plans/` while the work is in progress. Once it
ships, fold its lasting reasoning into the matching reference file here —
decisions, rejected options, traps — update [deployment.md](deployment.md), and
delete the plan. File-by-file step lists and verify checklists are not worth
keeping once the code exists.
