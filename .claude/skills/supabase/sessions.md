# Sessions, the device binding, and what expiry blocks

Covers `supabase/functions/login`, `supabase/functions/validate-token`,
`auth_login` / `auth_restore` / `auth_validate` / `auth_logout` /
`auth_change_password` in `auth.rs`, `core/auth.service.ts`,
`core/auth.guard.ts`, and `layout/shell/shell.ts`.

## Sign-in goes through `login`, not GoTrue

Checking a password needs only the anon key, but the device binding does not:
reading `device_id`, and claiming a null one, needs the service role key. A
check done in the app would live in code the person being checked is running.
So `login` verifies the password (`signInWithPassword` with the anon client),
then reads the profile with the service role, decides the binding, and only
then hands the session back.

- **A null `device_id` is claimed by the first machine to sign in** — this is
  also how support moves a licence: null the column. The claim is race-safe:
  the update carries `.is('device_id', null)`, so two machines racing cannot
  both win; the loser gets `conflict`.
- `login` returns GoTrue's session object **whole** (both tokens). The
  reference it was modelled on returned only `access_token`, which would have
  broken the refresh-token retry in `validated_session`.
- `auth.rs` no longer has its own `sign_in`; every GoTrue call that proves a
  password now happens inside an edge function, not from Rust — see "Change
  password" below.

## `validate-token`, and `validated_session`

`validate-token` takes `{ accessToken, deviceId }` in the body, resolves the
user with `anon.auth.getUser`, reads the profile with the service role, and
runs the same `status` / `device_id` checks as `login` — except a null
`device_id` is **refused, not claimed**: by the time a token exists, the
account already signed in once, so a null there is a broken row (or support
cleared it), not a first login.

`validated_session` in `auth.rs` is shared by `auth_restore` (once, at launch)
and `auth_validate` (every six hours), because they ask the same question:
load tokens → validate → on failure refresh once and validate again → clear
`session.json` if nothing usable comes back.

## Subscription status is written back by the server

`withCurrentSubscriptionStatus()` lives in **both** `login` and
`validate-token`, identical and deliberately duplicated. If
`subscription_status` is `trial` or `active` and `subscriptions_end_date` has
passed, it writes `expired` to `public.users` and returns the profile carrying
that status. A failed write is logged, not fatal — the response is still
right, and the next check retries.

Only `expired` is persisted. `expiring` (14 days or fewer left,
`EXPIRING_WITHIN_DAYS`) is computed in `build_subscription` and never stored,
because it changes on its own overnight.

## Decisions

- **A — a hard refusal clears everything.** Invalid token, wrong device,
  blocked or inactive account: tokens cleared, session signal dropped,
  `authGuard` bounces to `/login`.
- **B — an expired subscription locks every screen except `/profile`.** The
  account still signs in. This is a shop-floor tool, so the options were
  weighed against stopping waste logging mid-shift:
  - hard-block the whole app — worst failure mode on the floor, rejected;
  - read-only (screens open, entries refused) — more to build, no easier to
    leave, rejected;
  - warning banner only — enforces nothing, rejected;
  - **redirect to `/profile` — chosen**, because that is where renewal lives.
- **C — six hours, not hourly** (`VALIDATE_INTERVAL_MS` in `auth.service.ts`).
  A lapse is noticed up to six hours late; 4 calls a day per terminal, not 24.
- **A thrown error from `validate()` is ignored; only an explicit `null`
  signs out.** A network blip on this machine must never look like a real
  refusal.
- **No new Tauri event.** The timer calls the command, the command returns a
  fresh `Session`, the session signal updates, every screen follows. A second
  event channel beside `worker-log://data-changed` was deliberately avoided.
- **The nav is hidden, not disabled, while expired.** A disabled link reads as
  "the app is broken" on the floor; an empty nav plus the profile's banner
  reads as "the subscription lapsed". The guard is the actual enforcement —
  hiding only stops clicks that would bounce straight back.
- `authGuard` reads `subscriptionExpired()`, computed from
  `build_subscription`'s date math — so the gate works from the first tick
  after expiry, even before the server's write-back has landed.

## Change password

`auth_change_password` → `change-password` (function), one call, in the same
`{ accessToken, deviceId, ... }` shape as `verify-payment`. Rust's
`supabase::update_user` and `sign_in` (both GoTrue-direct) are gone —
`call_auth` now has exactly one caller, `refresh`.

The function, in order: resolve the caller with `auth.getUser()`; run the
**same account/device checks `validate-token` makes** (blocked / not active /
wrong PC — a stolen token used outside the app has to fail here too, not only
at the desktop client); re-prove `currentPassword` with a throwaway anon
`signInWithPassword`; `admin.auth.admin.updateUserById`; then two non-fatal
steps — **revoke every session** with `admin.auth.admin.signOut(accessToken,
'global')`, and mail a confirmation. `clear_tokens(&app)` in Rust follows a
success, and the Angular side (`Profile.savePassword`) then calls
`auth.logout()` and navigates to `/login`.

- **The global sign-out is what makes "sign in again" real, not theatre.**
  `updateUserById` is not documented to revoke existing sessions on its own;
  without the explicit sign-out the old refresh token — and the one the
  re-proof step just minted — would keep working. Non-fatal, because the
  password has already changed by the time it runs.
- **No password rules in the function** (length, new ≠ old) — both already
  live in the profile dialog, and the project rule is validation in the UI
  only. The function's one check is "all four fields present", so
  `signInWithPassword` is never called with `undefined`.
- It used to read the profile over PostgREST, which silently returned nothing
  under the live deny-all RLS and failed with "That account has no profile" —
  see [payments.md](payments.md#rls-deny-all-is-deliberate). Moving behind a
  function fixed that the same way `login`/`validate-token` already did.

## Porting a function from another project

The references these were adapted from (Pictoria's `login-user-test` /
`validate-token-test`, Visara's Razorpay pair) use different column names.
Map them, don't copy them:

| Reference | This project |
| --- | --- |
| `is_active` | `status` (`active` / `inactive` / `blocked`) |
| `subscription_end` | `subscriptions_end_date` (plural, `_date`) |
| `phone_number` | `phone` |
| `free_searches_remaining`, `onnx_key` | nothing — ignore |
| `user_id` in the body | `accessToken` in the body → `auth.getUser()` |
| `{ success, message }` | `{ error: { kind, message } }` |
| `serve()` + `deno.land/std` + `esm.sh` | `Deno.serve` + `npm:@supabase/supabase-js@2` |
| token/device in headers | in the body (`call_function` has no header parameter) |

Getting a column name wrong writes a column that does not exist and 400s, or
silently no-ops the part the feature depends on.
