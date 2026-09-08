# Login + periodic token validation

**Status: code complete (Rust + Angular + Supabase function files). Not yet
deployed** — the two edge functions need pasting into the dashboard; see
"Deploy steps" at the bottom.

## Decisions made

- **A — hard refusal:** clears tokens, drops the session, `authGuard` bounces
  to `/login`. As proposed.
- **B — expired subscription:** blocks everything but the profile screen.
  `authGuard` redirects there (`core/auth.guard.ts`); it is where a plans card
  will eventually live for clearing it. The account itself still signs in
  fine when expired — `login` and `validate-token` only refuse on account
  `status` and device mismatch, never on subscription. CLAUDE.md's "Accounts /
  licensing" section has been corrected to describe this rather than the
  all-or-nothing gate it used to claim.
- **C — six hours, not hourly.** `VALIDATE_INTERVAL_MS` in `auth.service.ts`.

Two edge functions — `login` and `validate-token` — plus an hourly revalidation
loop in the app. Modelled on the Pictoria `login-user-test` /
`validate-token-test` pair, adapted to this project's schema, error envelope
and existing session handling.

## What already exists — do not rebuild it

This is the part that matters most going in. Worker Log is **not** starting
from nothing here; roughly half of the reference's job is already done:

| Reference does | Worker Log already has |
| --- | --- |
| `signInWithPassword` | `sign_in()` → GoTrue `token?grant_type=password` (auth.rs:165) |
| device_id must match | `check_licence()` (auth.rs:210) — also checks `status` |
| account disabled check | `check_licence()`, on `status != 'active'` |
| stores token on the PC | `save_tokens` / `load_tokens` → `session.json` in the app data dir |
| days remaining | `build_subscription()` (auth.rs:241) computes `days_left` |
| expired-by-date | `build_subscription()` already *reports* `expired` and `expiring` |

So the genuinely new work is only:

1. Moving the profile read off PostgREST and onto a service-role edge function.
2. **Writing `expired` back to `public.users`** — today it is computed for
   display and never persisted (auth.rs:255 says so outright).
3. An hourly revalidation loop — nothing like it exists.
4. Actually **gating the app** on subscription status — CLAUDE.md line 252
   claims "only a registered account with an acceptable subscription status can
   open the app", but no code enforces it. `check_licence` looks at `status`
   and `device_id` only.

## Why this also fixes the outstanding "no profile" bug

`fetch_profile()` reads `public.users` through PostgREST **as the signed-in
user**, so RLS decides what comes back — and that read returning zero rows is
exactly the "That account has no profile" error still outstanding from
registration testing.

Both new functions read that row with the **service role key**, which bypasses
RLS entirely. Routing login and restore through them removes that failure mode
from the sign-in path without needing to diagnose the policy first. Worth
knowing: it does **not** fix `auth_change_password` or `auth_payments`, which
still read through PostgREST — so if RLS is genuinely misconfigured, those two
stay broken and still need the SQL check from earlier.

## Edge function 1 — `login`

**Correction to the audit above: `login/index.ts` was not vestigial.** It
turned out to be a complete, already-correct implementation in this
project's own conventions — the `ok`/`fail` envelope, race-safe
first-machine-claims-a-null-`device_id` logic, and it already returns
`signIn.session` whole (both tokens, not just `access_token` — the reference's
bug flagged below never applied to it). Only one thing was missing:
subscription expiry. Added a `withCurrentSubscriptionStatus()` helper — if
`subscription_status` is `trial` or `active` and `subscriptions_end_date` has
passed, writes `expired` back to `public.users` and returns the profile
carrying that status — called on both of the function's existing success
paths (freshly claimed, and already-bound device).

⚠️ Kept for the record: the *reference* returns only `access_token`, which
would have broken `auth_restore_impl`'s refresh-token retry (auth.rs:382) had
it been followed literally. Not an issue here since `login/index.ts` already
returned the whole session object.

## Edge function 2 — `validate-token`

New file, `supabase/functions/validate-token/index.ts` — genuinely new, no
existing draft to build on. Matches `login/index.ts`'s structure exactly
(same `ok`/`fail` helpers, same `PROFILE_COLUMNS`), including its own copy of
`withCurrentSubscriptionStatus()` — duplicated rather than shared, the same
way `send-otp` and `register` already duplicate their code-hashing logic,
since each function is pasted into the dashboard on its own.

Body in: `{ accessToken, deviceId }`. (The reference passes these as
`Authorization` / `x-device-id` headers; `supabase::call_function` always sets
`Authorization: Bearer <anon key>` and has no header parameter, so both go in
the body instead.)

1. `anon.auth.getUser(accessToken)` — invalid or expired → `fail('notFound', …)`.
2. Read the profile by `id`, service role.
3. Same `status` / `device_id` checks as `login`, but refusing rather than
   claiming a null `device_id` — by the time a token exists to validate, the
   account already signed in once.
4. `withCurrentSubscriptionStatus()`, same as `login`.
5. Return `ok({ profile })`.

Both functions: `{ error: { kind, message } }` envelope, not the reference's
`{ success, valid, message }` — Rust's `to_error()` (supabase.rs:76) branches
on `error.kind`. Column mapping, same trap as `register`: the reference's
`is_active`, `subscription_end` and `free_searches_remaining` are `status`,
`subscriptions_end_date` and *nothing* here. `onnx_key` ignored entirely.

## Rust (`src-tauri/src`)

5. `auth.rs` — `auth_login_impl` calls the `login` function instead of
   `sign_in` + `fetch_profile`, then saves both tokens and builds the session
   from the returned profile. Keep `sign_in()` — `auth_change_password_impl`
   still uses it to verify the current password.
6. `auth.rs` — extract the load → try → refresh-on-failure → retry dance that
   `auth_restore_impl` already implements into one helper (`validated_session`,
   named for what it now calls through — `validate-token` rather than the
   PostgREST `fetch_profile` the original dance used), so restore and the new
   command share it rather than duplicating it.
7. `auth.rs` — `auth_restore_impl` calls `validate-token` through that helper
   instead of `fetch_profile`.
8. `auth.rs` — new `auth_validate` command returning `AppResult<Option<Session>>`:
   `None` when there is no session or the licence fails (clearing tokens as
   restore does), `Some(session)` with fresh subscription state otherwise.
9. `lib.rs` — register `auth::auth_validate` in `generate_handler![]`. Nothing
   goes in `capabilities/default.json`.

`build_subscription()` stays as it is. Its `expiring` state is deliberately
computed and not stored (auth.rs:255) — only `expired` gets written back, and
the server is what writes it.

## Angular (`web/src/app`)

10. `core/tauri/tauri-commands.const.ts` — `authValidate: 'auth_validate'`.
11. `core/auth.backend.ts` + `core/tauri-auth.backend.ts` — `validate(): Promise<Session | null>`,
    reusing `RestoreResponse` (`Session | null`) rather than adding a new
    response type — the same shape `auth_restore` already answers with, same
    precedent as `SessionResponse` already covering both `auth_register` and
    `auth_login`.
12. `core/auth.service.ts` — `validate()` sets the session signal from the
    result (and stops the timer when the answer is `null`), driven by a
    `VALIDATE_INTERVAL_MS` (six hours — decision **C**) `setInterval` started
    after a successful restore/login and cleared on logout. `AuthService` is
    `providedIn: 'root'`, so it lives as long as the window and needs no
    component to host the timer. A *thrown* error from `validate()` (a network
    blip) is logged and otherwise ignored — only an explicit `null` answer
    signs the window out, so this machine's own connectivity trouble is never
    mistaken for a real refusal.

    The interval calls the command; the command returns a fresh `Session`; the
    signal updates; every screen bound to it follows. No new Tauri event was
    needed — this deliberately avoids adding a second event channel beside
    `worker-log://data-changed`.
13. `core/auth.guard.ts` — `authGuard` (already `canActivateChild` on every
    route under the shell) also checks `auth.subscriptionExpired()` and
    redirects to `/profile` — decision **B**. `AuthService.subscriptionExpired`
    is a computed off `subscription()?.status === 'expired'`, which
    `build_subscription()` already produces purely from the end date, so the
    gate works from the very first tick after expiry even before an edge
    function's write-back has landed in the database.

## Decisions

**A. Hard refusal** — invalid token, wrong device, account blocked. Clears
tokens, drops the session signal, `authGuard` bounces to `/login`. Matches
what `auth_restore` already did.

**B. Expired subscription.** Blocks every screen but `/profile`, which is
where a plans card will eventually let the operator clear it. This is a
shop-floor tool, so the alternative — hard-blocking the whole app — would have
stopped waste logging mid-shift the moment a card lapsed; blocking everything
but profile was chosen instead. The original options considered:

- Hard block — matches CLAUDE.md's stated intent at the time, worst failure
  mode for a shop-floor tool. Not chosen.
- Read-only — screens open, the waste grid refuses new entries. Not chosen —
  more to build than the redirect, for a state this plan does not otherwise
  make it any easier to leave than the redirect does.
- Warning banner only — nothing enforced. Not chosen — contradicts the point
  of gating on subscription at all.
- **Block everything but `/profile` and redirect there — chosen.** CLAUDE.md's
  "Accounts / licensing" section has been corrected to describe this rather
  than the all-or-nothing gate it used to claim.

**C. Six hours, not hourly.** A lapse is noticed up to six hours late; the app
makes 4 calls a day per terminal rather than 24.

## Verify

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cd web && npm test -- --watch=false && npx ng build
npx prettier --write src/app/...   # web/ only — supabase/ isn't prettier-managed
```

Manual, once deployed: sign in; confirm `session.json` appears in the app data
dir; set `subscriptions_end_date` to yesterday in the dashboard, wait for the
tick (or restart), confirm `subscription_status` flips to `expired` in
`public.users`, and confirm the app redirects to `/profile` and refuses to
navigate anywhere else.

## Deploy steps (yours, as before)

1. Deploy `login` and `validate-token`, Verify JWT **off** on both.
2. No new secrets — both use the platform-injected `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Both also use `SUPABASE_ANON_KEY` (`login` for the password check,
   `validate-token` for `getUser`); injected by the platform too, nothing to
   set.
