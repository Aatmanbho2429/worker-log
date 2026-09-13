# Plans, Razorpay, payment history, and the subscription card

Covers `supabase/functions/get-plans`, `create-order`, `verify-payment`,
`get-user-subscriptions`, migrations `0003_payments.sql` and
`0004_current_subscription.sql`, `auth_plans` / `auth_create_order` /
`auth_verify_payment` / `auth_payments` and `build_subscription` in `auth.rs`,
`core/razorpay.service.ts`, `views/profile/`, and `tauri.conf.json`'s CSP.

## The plan catalogue — `get-plans`

- **A function, not a PostgREST read.** The expired operator is exactly the
  one who needs this screen, and their access token may be mid-refresh — so
  the catalogue must not depend on holding a valid token. It reads with the
  service role key and takes **no token at all**. `auth_plans_impl` therefore
  has no `AppHandle` and never calls `load_tokens` — the one `auth_*` command
  that works signed out. Accepted as the most exposed function (no auth, no
  rate limit): it is one indexed read of a four-row price list.
- Reads `id, name, duration, amount, currency` where `is_active`, ordered by
  `sort_order`, and answers `{ plans: [...] }` — an object, not a bare array,
  so a field can be added later without breaking Rust.
- `Plan` is deserialised straight off the wire in Rust, unlike the private
  `ProfileRow` / `SubscriptionRow`. Those exist so a *table* column rename
  cannot silently change what the window gets; this response is shaped by our
  own function, so that indirection buys nothing.

## The plans dialog on the profile

- **Shown only while `expired` or `expiring`.** An operator with months left
  sees the profile unchanged and `get-plans` is never called.
- **A `p-dialog`, not an inline section.** It auto-opens once per session the
  first time `showPlans()` turns true, from an `effect` (not the constructor —
  the six-hourly tick can flip status while the profile is already open). The
  `plansLoaded` flag gates both the fetch and the auto-open, so closing it
  does not reopen it; the "View plans" button on the subscription card does.
- **Layout:** custom `#header` template; width `90vw` capped at `78rem`; four
  columns stepping to two at **1100px** and one at 560px — 1100 because the
  app's minimum window width is 1024, so the narrowest window always gets two
  columns rather than a cramped four. Skeleton tiles use the same grid so
  nothing reflows on load.
- **"Best value"** goes to the cheapest plan *per day* (`bestPlanId`), not the
  longest term. Its ribbon and border use `$band` / `$band-text` (fixed navy
  on white in both themes), not `$text-accent`, which is not guaranteed dark
  enough to carry white text in the dark theme.
- `[focusOnShow]="false"` — with no input to focus, PrimeNG autofocused the
  first "Choose plan" button and its focus ring looked broken.
- **Display order is longest term first** via `orderedPlans` (reversed for
  the template only). `get-plans` still answers in `sort_order` ascending, and
  `bestPlanId` and every id-keyed read use that untouched order.
- A per-day price line was tried and removed after review.

## Razorpay checkout

**Checkout runs inside the webview** (`checkout.razorpay.com/v1/checkout.js`),
not the system browser. It is proven in Visara and is the only approach that
gets a signed callback instead of polling or a webhook.
`core/razorpay.service.ts` is the one file in `web/` that reaches a
third-party host, and deliberately: a card form needs a browser context, and
the `key_id` it carries is Razorpay's publishable key. The secret stays on the
edge function.

- `RazorpayService.open()` returns a promise, not callbacks. It rejects with a
  typed `RazorpayCancelled { reason }` — `dismissed` / `paymentFailed` /
  `gatewayUnavailable` — so `Profile.selectPlan` branches without parsing
  strings. **Only `dismissed` is silent**: the operator closed it on purpose.
- `payingPlanId` disables every plan button while one checkout is open.
- **Prefill and the description come from the client**
  (`AuthService.user()` already holds name/email/phone). **The price never
  does**: `create-order` re-reads `plans.amount` itself.

### The CSP — the change most likely to break the whole app

`tauri.conf.json` runs a strict CSP. Visara has `"csp": null`, which is the
only reason its script loader works there; here the script would silently not
load. The policy names Razorpay hosts only (`script-src` names exactly
`https://checkout.razorpay.com`; `img-src`/`font-src`/`connect-src` allow
`https://*.razorpay.com`; `frame-src` and `form-action` allow
`api.razorpay.com`).

⚠️ **`connect-src` must keep `ipc:` and `http://ipc.localhost`.** With no
`connect-src`, Tauri IPC inherits `default-src 'self'`. Writing an explicit
`connect-src` *replaces* that, so leaving the IPC origins out stops **every**
Tauri command in the app, not just payments. After any CSP edit, run `npm run
dev` and use an ordinary screen (add and undo a waste entry) before testing
payments.

## `create-order`

Body `{ accessToken, planId }` → `{ orderId, amount, currency, keyId }`.

- Caller proved with `auth.getUser()`. The Visara reference took `user_id` and
  returned that user's name, email and phone — PII for any guessed uuid.
- **Returns no user object at all**, so even a broken token check has nothing
  to leak.
- Refuses a `users.status` that is not `active` — a blocked account cannot buy
  its way back in.
- Amount in **paise**: `Math.round(plan.amount * 100)`. Rust's `RazorpayOrder.amount`
  is `i64` paise, deliberately not the `f64` rupees `Plan.amount` carries.
- `receipt` is `wastelog_<uid8>_<epoch>` (Razorpay caps it at 40 chars);
  `notes` carries `user_id` / `plan_id` / plan name for reconciliation.
- Razorpay orders API with Basic auth from `RAZORPAY_KEY_ID_PROD` /
  `RAZORPAY_KEY_SECRET_PROD`.

## `verify-payment`

Body `{ accessToken, planId, razorpayOrderId, razorpayPaymentId, razorpaySignature }`.

1. **Signature** — HMAC-SHA256 of `orderId|paymentId` with the key secret,
   compared to `razorpaySignature`. This is the only check that proves money
   moved: the widget runs in the operator's webview, where a modified client
   could claim success. `crypto.subtle` is a Deno global; no import needed.
2. Caller proved with `auth.getUser()`.
3. **Replay guard** — a `razorpay_payment_id` already on file means a retry,
   not a new payment: answer with the existing term instead of inserting and
   extending again. The partial unique index on `razorpay_payment_id` in
   `0003` is the backstop for two calls racing past this check (partial, so
   hand-written rows with no payment id don't collide). ⚠️ **That index is not
   live** — see [deployment.md](deployment.md).
   The retry path also fills `users.current_subscription_id` **only if it is
   still null**, repairing a first call whose insert landed but whose `users`
   update failed. It can never move the pointer backwards onto an older term.
4. **New term starts at `max(now, subscriptions_end_date)`, regardless of
   status.** The reference extended only when `active`, so a mid-trial
   purchase lost the remaining trial days. One expression covers trial,
   active and expired, and never takes away time already had.
5. Insert the `subscriptions` row (`status: 'active'`, which is in
   `SETTLED_PAYMENT_STATUSES`, so "Paid to date" counts it) with
   `.select('id').single()`.
6. Update `users`: `subscription_status: 'active'`, the new
   `subscriptions_end_date`, and `current_subscription_id` = the new row.

`auth_verify_payment` **discards the function's answer** and returns
`validated_session()` instead — the server has already written the new status,
so re-reading it avoids a second copy of `build_subscription`'s logic.
`AuthService.verifyPayment` replaces the session signal with it, which clears
`subscriptionExpired()` and brings the nav back without a reload. A `None`
there is surfaced as an error: the money moved, so a session that won't rebuild
is a real fault.

After a successful payment `Profile.selectPlan` also re-runs `load()` — the
payment history is otherwise fetched only in the constructor, and the new row
would not appear until the screen was rebuilt, under a card that had already
updated.

## Payment history — `get-user-subscriptions`

Body `{ accessToken }` → `{ subscriptions: [...] }`, newest first, read with the
service role for the `auth.getUser()` id. It replaced a PostgREST read of
`subscriptions` with the operator's token. `auth_payments`' name, signature
and `Payment` output did not change.

- The select includes `razorpay_order_id` although the reference omitted it:
  `Payment.reference` falls back to it for an order with no captured payment.
  A no-op today (`verify-payment` only inserts with both ids), a safety net
  for a future webhook flow that records `pending` rows.
- `plans(name, duration)` keeps `duration` though Rust ignores it — cheaper
  than stripping and re-adding.
- `Payment.id` is a synthetic 1-based row number, not the uuid.

## The subscription card — `users.current_subscription_id`

A foreign key (`0004`, constraint `users_current_subscription_id_fkey`,
`on delete set null`) pointing at the `subscriptions` row the licence runs on.

- **A pointer, not a copy.** `0001` argues against a `plan` column on `users`
  because it would duplicate a fact that changes on upgrade. This stores
  *which row*, never the plan name or dates, so nothing can drift.
- **Embedded in `login` / `validate-token`'s existing profile read**, not a
  separate "get user info" function — every `Session` is built from one of
  those two, so the card costs no extra round trip:
  `current_subscription:subscriptions!users_current_subscription_id_fkey(start_date, end_date, status, plans(name))`.
  ⚠️ **The `!…_fkey` hint is mandatory.** `subscriptions.user_id → users.id`
  links the same two tables the other way, so without it PostgREST refuses the
  query as ambiguous and **sign-in fails for every account**.
- `ProfileRow.current_subscription` is `#[serde(default)]`, so an older
  deployed function that doesn't send it still deserialises (card reads
  "No plan").
- **An expired term keeps its pointer.** The card reads "Monthly" + Expired,
  which is truer than "No plan". The pointer only moves on a new purchase. A
  trial has no row, so it stays null and reads "Trial".
- The renewal date and days-left still come from
  `users.subscriptions_end_date`, not the pointed row.

### Buying a new plan before the current one ends

The pointer always moves to the row just bought (chosen over leaving it on the
running term until it ends, which would need the renewal date and days-left to
read off two different rows). Because the new term starts at the old one's
end date, `startedOn` can be in the future — so `Profile.startLabel` shows
"Starts" instead of "Started" when `startedOn` is later than today. The
progress bar needed no fix: `termUsed()` already clamps to 0–100, so a
future-dated term shows 0%.

## RLS: deny-all is deliberate

Checked live on 2026-09-13: RLS is enabled on `users`, `subscriptions`,
`plans` and `email_otps`, and `pg_policies` is **empty** — `0001`'s policies
were never created. So every PostgREST read with a user token returned zero
rows, silently. That was the real cause of two bugs, not missing data:

- the card said **"No plan"** for an active paid Monthly term (the old
  `fetch_current_subscription` got `[]` and its `.ok()?` hid it; "Started"
  only looked right because the account registered the day it paid);
- **change password** failed with "That account has no profile".

The fix moved those reads behind functions rather than creating the policies.
With nothing in the app reading tables directly, a policy would permit nothing
the app uses — only the anon key (compiled into every binary) plus a stolen or
valid user token reading rows directly, around every check the functions make.
**Do not run `0001`'s policy section** unless something outside this app (an
admin dashboard, say) genuinely needs user-token table reads.
