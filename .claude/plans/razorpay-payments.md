# Razorpay checkout, and turning a paid plan into an unblocked app

**Status: code complete (Rust + Angular + Supabase function files). Not yet
deployed** — `create-order` and `verify-payment` need pasting into the
dashboard, and `0003_payments.sql` needs running; the two Razorpay secrets
are already set on this project (confirmed by the user, same names the
functions read). See "Deploy steps" at the bottom.

`subscription-plans.md` left `Profile.selectPlan()` as a live no-op with a
comment saying Razorpay goes here. This is that work: the button opens
Razorpay's checkout, the payment is verified server-side, and the app unblocks
itself without the operator signing out and back in.

Ported from the Visara-Tauri pair the user supplied
(`create-order` / `verify-payment` on project `qpxvwdxuhgbthzbcppye`), reusing
the same Razorpay account and keys. **Seven things change in the port** — they
are listed against each function below, and none of them are cosmetic.

## Decisions made

- **A — same flow as the reference.** Checkout runs in the webview
  (`checkout.razorpay.com/v1/checkout.js`), not in the system browser. It is
  the approach that is already proven in Visara, and the only one that gets a
  signed callback rather than needing polling or a webhook. It costs a CSP
  widening — see the next section, which is the single biggest risk here.
- **B — the operator is identified by their access token, not by a
  `user_id` in the body.** The reference trusts a bare `user_id`; see
  "Delta 3" for why that is not portable as-is.
- **C — `auth_verify_payment` answers with a fresh `Session`,** not with
  loose subscription fields. `validated_session()` (auth.rs:425) already
  rebuilds the exact shape the app holds, and the server has written the new
  status by then — so the UI just replaces its session signal and everything
  downstream (`subscriptionExpired()`, `authGuard`, the shell nav, the
  profile card) follows on its own. No new plumbing.
- **D — the app name and plan description come from the client, the money
  never does.** `create-order` re-reads `plans.amount` from the database, the
  same as the reference. Nothing the window sends decides a price.

## What already exists — do not rebuild it

| Needed | Already there |
| --- | --- |
| The plans dialog and its per-card button | `profile.html`, `Profile.selectPlan()` — the seam this fills |
| The catalogue | `auth_plans` → `get-plans`, shipped |
| Knowing who is signed in | `AuthService.user()` → `UserAccount { id, firstName, lastName, email, phone }` — **all of Razorpay's `prefill` is already in the window** |
| Re-reading the session after a change | `validated_session()` (auth.rs:425), behind `auth_validate` |
| Unblocking the app once active | `authGuard` + `Shell.visibleSections` react to `subscriptionExpired()` |
| The `ok`/`fail` envelope, service-role client, CORS block | every function under `supabase/functions/`, `get-plans` most recently |
| Rendering the paid row afterwards | the profile's payment history reads `subscriptions` already |

So the new work is: two edge functions, one CSP change, one migration, three
Rust commands' worth of plumbing, and a script loader on the Angular side.

## The CSP is the biggest risk in this change

`src-tauri/tauri.conf.json` sets a strict policy today:

```
default-src 'self'; img-src 'self' data: asset: http://asset.localhost;
style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'
```

Visara has **`"csp": null`** — no policy at all — which is the only reason the
reference's `document.createElement('script')` works there without any config
change. Under worker-log's policy that script never loads, and the failure is
quiet: a console error, `window.Razorpay` undefined, and a button that looks
broken. Widen it to:

```
default-src 'self';
img-src 'self' data: asset: http://asset.localhost https://*.razorpay.com;
style-src 'self' 'unsafe-inline';
font-src 'self' data: https://*.razorpay.com;
script-src 'self' https://checkout.razorpay.com;
frame-src https://api.razorpay.com https://checkout.razorpay.com;
connect-src 'self' ipc: http://ipc.localhost https://*.razorpay.com;
form-action https://api.razorpay.com
```

Scoped to `razorpay.com` hosts — not a blanket `*`, and `script-src` names the
one exact host that may serve script.

⚠️ **`connect-src` is the line that can take the whole app down.** There is no
`connect-src` today, so it inherits `default-src 'self'`, and Tauri's own IPC
is reaching `invoke` under that. The moment an explicit `connect-src` is
written it *replaces* that inheritance, so it must carry `ipc:` and
`http://ipc.localhost` (the v2 IPC origins, platform-dependent) or **every
Tauri command in the app stops working** — not just payments. Test `npm run
dev` and click through one ordinary screen (waste log, say) before assuming
the CSP edit is harmless.

## Schema — check before writing the insert

`0001_account_schema.sql` never created `users` / `subscriptions` / `plans`;
they predate it, and the only proof of their columns is what `auth.rs` reads
today (`SUBSCRIPTION_COLUMNS`, auth.rs:99) plus the RLS policies. From those,
these are certain: `subscriptions.user_id` (the policy filters on it),
`plan_id` (the `plans(name)` embed needs the FK), `amount`, `currency`,
`status`, `start_date`, `end_date`, `razorpay_order_id`,
`razorpay_payment_id`, `payment_method`, `created_at`.

**`razorpay_signature` is not among them** — worker-log never reads it, and
the reference writes it. Rather than guess, add
`supabase/migrations/0003_payments.sql`, idempotent like its neighbours:

```sql
alter table public.subscriptions
  add column if not exists razorpay_signature text;

-- One payment can only ever buy one term. Without this a replayed
-- verify-payment call writes a second row and extends the licence again,
-- free — see Delta 5.
create unique index if not exists subscriptions_razorpay_payment_id_key
  on public.subscriptions (razorpay_payment_id)
  where razorpay_payment_id is not null;
```

The partial index matters: rows written by hand, or a future trial row, carry
a null payment id and must not collide with each other.

## Edge function 1 — `supabase/functions/create-order/index.ts`

Same job as the reference: read the plan, create a Razorpay order, hand back
what checkout.js needs. Structure copied from `get-plans`/`validate-token`
(house `ok`/`fail`, `Deno.serve`, `npm:@supabase/supabase-js@2`,
self-contained), **not** from the reference's `serve()` +
`deno.land/std@0.168.0` + `esm.sh` imports.

Body in: `{ accessToken, planId }`. Out: `ok({ orderId, amount, currency, keyId })`.

**Deltas from the reference:**

1. **Envelope.** `{ error: { kind, message } }`, never `{ success: false }` —
   `supabase.rs`'s `to_error()` branches on `error.kind`, so a `success` flag
   would surface to the operator as a generic 500 with the real message
   swallowed.
2. **camelCase body**, matching `validate-token`'s `accessToken` /
   `deviceId` and `register`'s `otpCode`. The reference is snake_case
   throughout.
3. **The caller is proved, not asserted.** The reference takes `user_id` from
   the request body and returns that user's name, email and phone — so anyone
   who can reach the function with a guessed uuid gets PII back. Here: take
   `accessToken`, call `anon.auth.getUser(accessToken)` (exactly what
   `validate-token/index.ts` already does), and use the id it returns.
4. **No user object in the response at all.** Razorpay's `prefill` is built
   client-side from `AuthService.user()`, which the window already holds — so
   the leak in Delta 3 has nothing left to leak even if the token check were
   wrong. Response shrinks to four fields.
5. Refuse a `users.status` that is not `active` — a blocked account should not
   be able to buy its way back in. Free to check, since the profile row is
   already being read.
6. `receipt` becomes `wastelog_<uid8>_<epoch>` (the reference's `visara_`
   prefix, renamed; stays inside Razorpay's 40-char limit).
7. `notes` keeps `user_id` / `plan_id` / plan name, for reconciling in the
   Razorpay dashboard.

Keys: `RAZORPAY_KEY_ID_PROD` / `RAZORPAY_KEY_SECRET_PROD`, Basic-auth'd to
`https://api.razorpay.com/v1/orders`, amount `Math.round(plan.amount * 100)`
in paise — all straight from the reference.

## Edge function 2 — `supabase/functions/verify-payment/index.ts`

Body in: `{ accessToken, planId, razorpayOrderId, razorpayPaymentId, razorpaySignature }`.
Out: `ok({ subscriptionEnd })` — the app rebuilds its own session afterwards
(decision **C**), so this need not return status or days remaining.

The signature check is the reason this function exists and is copied
verbatim in substance: HMAC-SHA256 over `orderId|paymentId` with
`RAZORPAY_KEY_SECRET_PROD`, hex-compared to `razorpaySignature`. `crypto.subtle`
is a global in Deno — drop the reference's
`import { crypto } from "deno.land/std@0.168.0/crypto/mod.ts"`.

**Deltas from the reference,** on top of 1–3 above (envelope, camelCase,
token-derived user):

4. **Column names.** This is the same trap `register` hit and
   `token-validation.md` recorded: the reference writes
   `users.subscription_end`; here the column is **`users.subscriptions_end_date`**
   (plural `subscriptions`, and `_date`), and it reads
   `users.phone`, not `phone_number`. Getting this wrong writes a column that
   does not exist and 400s, or worse, silently no-ops the part the whole
   feature depends on.
5. **Replay guard.** The reference inserts unconditionally, so calling it
   twice with one real signature buys two terms. Before inserting, select
   `subscriptions` by `razorpay_payment_id`; if a row exists, return `ok` with
   the existing `end_date` rather than inserting or extending again. The
   unique index from the migration is the backstop if two calls race.
6. **Where the new term starts.** The reference extends from the current end
   date only when `subscription_status === 'active'`, so a **trial** with days
   left loses them on purchase. Use
   `startDate = max(now, subscriptions_end_date)` regardless of status — one
   expression that covers trial, active and expired, and never takes away
   time the operator already had.
7. `status: 'active'` on the inserted row is kept — it is one of
   `PaymentStatus`'s values and one of `SETTLED_PAYMENT_STATUSES`, so the
   profile's "Paid to date" total picks it up with no further change.

## Rust (`src-tauri/src`)

1. **`models/response/razorpay_order.rs`** — `RazorpayOrder { order_id,
   amount, currency, key_id }`, `#[serde(rename_all = "camelCase")]`.
   `amount` is `i64` (paise, integer — Razorpay's own unit), deliberately not
   the `f64` rupees `Plan.amount` carries.
2. **`models/request/verify_payment_request.rs`** — `VerifyPaymentRequest
   { plan_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }`.
   A multi-field payload, so it earns a request model; `create_order` takes a
   bare `plan_id: String` instead, matching `auth_send_otp(email: String)`.
3. **`models/{request,response}/mod.rs`** — re-export both.
4. **`auth.rs`** — two `<name>_impl` + `#[tauri::command]` pairs:
   - `auth_create_order(app, plan_id) -> ApiResponse<RazorpayOrder>` — loads
     tokens (`NotFound "You are not signed in."` if absent, same as
     `auth_payments`), posts `{ accessToken, planId }`.
   - `auth_verify_payment(app, payload) -> ApiResponse<Session>` — posts the
     five fields, then **discards the function's own answer** and returns
     `validated_session(&app).await`, erroring `Internal` if that comes back
     `None` (the payment did land; a session that will not rebuild right
     afterwards is a real fault worth surfacing).
5. **`lib.rs`** — register both in `generate_handler![]`. Nothing goes in
   `capabilities/default.json`.

## Angular (`web/src/app`)

6. **`models/response/razorpayOrder.ts`** + **`models/request/verifyPaymentRequest.ts`**,
   mirroring the Rust structs; re-export through the two `index.ts` barrels and
   `models/auth.ts` (the account domain's own re-export point).
7. **`core/tauri/tauri-commands.const.ts`** — `authCreateOrder`,
   `authVerifyPayment`.
8. **`core/auth.backend.ts` + `core/tauri-auth.backend.ts`** —
   `createOrder(planId)`, `verifyPayment(payload)`.
9. **`core/auth.service.ts`** — `createOrder()` delegates; `verifyPayment()`
   delegates **and sets the session signal from the `Session` it gets back**,
   the way `login()` already does. That one line is what unblocks the app.
10. **`core/razorpay.service.ts`** — new, and the only file that touches
    `checkout.razorpay.com` or `(window as any).Razorpay`. Loads the script
    once (idempotent by element id, rejecting if it fails to load), opens
    checkout, and resolves a promise with the three `razorpay_*` fields on
    success / rejects on dismissal or `payment.failed`. It belongs in `core/`
    beside `scan.service.ts`: cross-cutting, no UI, browser-level rather than
    a Tauri-calling entity service.

    Promise-shaped rather than callback-shaped on purpose — it turns the
    reference's nested `handler` → `NgZone.run` → verify chain into a flat
    `await`, and `ZoneWrapperService` already re-enters the zone on the
    Tauri call that follows, so the only zone concern left is the resolve
    itself.

    **Note for the implementer:** this is the one place the project's
    "no third-party network calls from `web/`" habit is deliberately broken,
    and it cannot be otherwise — a card form has to run in a browser context,
    and the `key_id` it carries is Razorpay's publishable key. The *secret*
    stays on the edge function. Worth a comment in the file saying so, since
    it reads as a rule violation otherwise.
11. **`views/profile/profile.ts`** — `selectPlan()` stops being a no-op:
    `payingPlanId` signal for the per-card spinner, then
    `createOrder → razorpay.open(...) → verifyPayment`, with
    `notify.fromCommand` on failure and a success toast. A dismissed checkout
    resets `payingPlanId` and says nothing — the operator closed it on
    purpose. On success the dialog closes itself; the guard and nav come back
    on their own from the session signal.
12. **`views/profile/profile.html`** — `[loading]="payingPlanId() === plan.id"`
    and `[disabled]="payingPlanId() !== null"` on the plan buttons, so a
    second click cannot open a second checkout.

## Copy (`web/src/assets/i18n/en.json`)

Under `profile.*`: `paymentSuccess` (`"{{ plan }} activated — {{ days }} days
added."`), `paymentFailed`, `paymentCancelled` (if shown at all — see step 11),
`gatewayFailed` ("Could not load the payment gateway. Check this machine's
internet connection.").

## Docs to update in the same change

- **CLAUDE.md** — done: command count 40 → 42, "ten `auth_*` commands" →
  twelve, the edge-function list gains `create-order` and `verify-payment`
  (six → eight, three migrations), the "Accounts / licensing" section's
  no-op sentence rewritten to describe the real flow, and a note added on why
  `tauri.conf.json`'s CSP now names Razorpay hosts and keeps `ipc:` /
  `http://ipc.localhost` explicit in `connect-src`.
- **`supabase/README.md`** — done: two more function-table rows, the
  `RAZORPAY_KEY_ID_PROD` / `RAZORPAY_KEY_SECRET_PROD` secrets note (with the
  `_PROD` naming flagged as inherited, not a guarantee of which keys are
  actually set), and the CLI deploy command's function list extended.
- **`subscription-plans.md`** — done: decision **B** ("the plan card's
  button is a no-op for now") struck through and pointed here.
- **This file** — status line, done (code complete). Still needed once
  deployed: the manual pass below, and flipping the line again.

## Where the implementation departed from this plan

Nothing structural — the edge functions, the Rust commands and the Angular
wiring all match what is written above. Two things were decided while
writing the code that this plan left open:

- **`RazorpayCancelled`, not a bare rejection.** `RazorpayService.open()`
  rejects with a typed `RazorpayCancelled { reason }` — `dismissed` /
  `paymentFailed` / `gatewayUnavailable` — rather than a plain `Error`, so
  `Profile.selectPlan` can branch without parsing a message string. Only
  `dismissed` is silent (decision already implied by "a dismissed checkout
  resets `payingPlanId` and says nothing," but the mechanism for telling it
  apart from a real failure needed choosing).
- **One more copy key than listed:** `profile.paymentDescription`
  (`"{{ plan }} plan"`), used for the widget's own `description` field. Not
  strictly required — Razorpay would take a hardcoded string just as well —
  but `.claude/skills/extract-static-text` reads as covering any user-facing
  string written in a component, and the widget's description is read by the
  operator even though it never touches an Angular template.
- **This file** — status line, once deployed.

## Verify

```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cd web && npm test -- --watch=false && npx ng build
npx prettier --write src/app/...   # web/ only
```

Manual, in this order — the CSP first, because everything else is wasted if
it is wrong:

1. `npm run dev`, open the waste log, add and undo an entry. **If ordinary
   Tauri commands still work, `connect-src` is right.** If they do not, fix
   that before touching payments.
2. Expire the subscription (`subscriptions_end_date` to yesterday), reopen —
   plans dialog auto-opens as before.
3. Click a plan. Razorpay's modal should open; if it does not, the console
   will name the CSP directive that blocked it.
4. Pay with Razorpay's test card (`4111 1111 1111 1111`, any future expiry,
   any CVV) **against test keys** — see "Confirm before implementing".
5. Expect: dialog closes, toast, subscription card flips to Active with the
   new end date, **Floor and Masters reappear in the nav without a reload**,
   and a row appears in the payment history with the Razorpay payment id.
6. Check `public.subscriptions` for exactly one new row, and
   `public.users.subscriptions_end_date` for the new date.
7. Call `verify-payment` a second time with the same three `razorpay_*`
   values (curl). Expect: no second row, no further extension — Delta 5.
8. Dismiss a checkout mid-payment: no toast, button returns to normal, no row.

## Deploy steps (yours)

1. Deploy `create-order` and `verify-payment`, Verify JWT **off** on both
   (they carry the operator's token in the body and check it themselves, the
   way `validate-token` does).
2. Set the two secrets **on the worker-log project** (`ujalkizozxeshrheuhkb`)
   — see below.
3. Run `0003_payments.sql` in the SQL editor.

## Confirm before implementing

1. ~~Which project holds the Razorpay secrets?~~ **Settled:** set on the
   worker-log project (`ujalkizozxeshrheuhkb`) under the reference's own
   names, `RAZORPAY_KEY_ID_PROD` / `RAZORPAY_KEY_SECRET_PROD`. The functions
   read those two names directly; nothing to parameterise.
2. **Test keys or live keys? Still open, and it only bites at step 4 of the
   manual pass** — not during implementation, so this does not block writing
   any of it. But `_PROD` reads as live, and a live `key_id` reaching
   checkout means step 4 charges a real card ₹499 for the cheapest plan, with
   a real refund to undo it. Razorpay's test keys are `rzp_test_…` and live
   are `rzp_live_…`: check which is in the secret before the first payment.
   Test mode also refuses the `4111 1111 1111 1111` card the plan names, so
   if that card is declined, the secret is live.
3. **Does `public.subscriptions` already have `razorpay_signature`?** Still
   unknown and still fine — `0003_payments.sql` is `add column if not
   exists`, correct either way.
