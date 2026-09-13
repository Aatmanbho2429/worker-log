# Payment history through an edge function, not PostgREST

**Status: planned, nothing written yet.** Needs one new edge function
deployed — see "Deploy steps" at the bottom.

`auth_payments` — the payment history table on the profile — has never gone
through an edge function. It reads `subscriptions` directly over PostgREST
with the operator's own access token, relying on row level security to limit
it to their own rows. This plan replaces that transport with
`get-user-subscriptions`, ported from the reference the user supplied, while
keeping the command's name, signature and output completely unchanged — so
the `Payment` model and the whole Angular chain behind it stay as they are.
It also fixes the one thing that genuinely was not fetching everything: a
payment just made never reached the table until the screen was rebuilt
(decision **D**).

**Which project: this one, `ujalkizozxeshrheuhkb`.** The function is written
into `supabase/functions/` here and deployed to worker-log's own Supabase
project, reading worker-log's own `subscriptions` and `plans` tables. The
supplied reference happens to live on a different project, but nothing about
that project is carried over — not its URL, not its keys, not its schema.
Nothing needs configuring for this either: `supabase::call_function` builds
every URL from `supabase.rs`'s `project_url()`, which already points at this
project, so the new function is reached the same way the other eight are.

## Decisions made

- **A — swap the transport, not the shape.** `auth_payments(app) ->
  ApiResponse<Vec<Payment>>` keeps its name and its return type. Only the
  body of `auth_payments_impl` changes: `supabase::select(...)` becomes
  `supabase::call_function("get-user-subscriptions", ...)`. Everything
  downstream of it — `Payment`, `TAURI_COMMANDS.authPayments`,
  `AuthBackend.payments()`, `Profile.load()`, the payment history table in
  `profile.html` — is untouched. Chosen because the reference answers with
  the same rows this already reads, in the same order; there is no new field
  or capability to plumb through, only a different way of fetching what was
  already being fetched.
- **B — the caller is proved, not asserted, same as the other three
  functions.** The reference takes a bare `user_id` from the body and reads
  that user's rows with no check that the caller is who they say — anyone
  who could reach the function with a guessed uuid would get a stranger's
  payment history. Ported version takes `accessToken` and resolves the id
  with `auth.getUser()`, the pattern `validate-token` / `create-order` /
  `verify-payment` already use.
- **C — `fetch_current_subscription` is out of scope.** `auth.rs` has a
  *second*, narrower PostgREST read of `subscriptions` — `status=eq.active
  order=end_date.desc limit=1`, used to build the subscription card's plan
  name and term dates in `build_session`/`build_subscription`, not the
  history table. Nothing supplied covers that read, and the ask was payment
  history specifically. Left alone; flagged here so it is not assumed to
  have moved too. If it should move as well later, it is the same shape of
  change as this one.
- **D — refresh the history after a payment, which it does not do today.**
  Found while writing this plan, and quite possibly the actual complaint
  behind it: `Profile.load()` — the only thing that fetches payments — runs
  **once, in the constructor** (profile.ts:205). `selectPlan` finishes a
  successful payment by showing a toast and closing the dialog
  (profile.ts:377–383) and never re-fetches, so **a payment the operator
  just made does not appear in the table** until they navigate away and back
  (which reconstructs the component) or restart the app. The subscription
  *card* updates immediately, because `verifyPayment` replaces the session
  signal — which makes the stale table below it look all the more wrong. One
  line fixes it; see the Angular section.

## What already exists — do not rebuild it

| Needed | Already there |
| --- | --- |
| The `Payment` model, both sides | `src-tauri/src/models/response/payment.rs`, `web/.../response/payment.ts` |
| The Tauri command, wired end to end | `auth_payments` → `TAURI_COMMANDS.authPayments` → `AuthBackend.payments()` → `Profile.load()` → the table in `profile.html` |
| The row → `Payment` mapping | The `.map(...)` in `auth_payments_impl` (auth.rs:573) — reused as-is, only what it maps *from* changes |
| The house edge-function shape (`ok`/`fail`, CORS, service-role client) | `get-plans` / `create-order` / `verify-payment`, all in `supabase/functions/` |
| Token-proving a caller | `validate-token`'s `anon.auth.getUser(accessToken)` pattern, already reused twice |

So the only new work is: one edge function, one config entry, roughly ten
changed lines in `auth_payments_impl`, and one line in `Profile.selectPlan`.

## Edge function — `supabase/functions/get-user-subscriptions/index.ts`

Structure copied from `verify-payment`/`create-order` (house `ok`/`fail`,
`Deno.serve`, `npm:@supabase/supabase-js@2`, self-contained) — **not** the
reference's `serve()` + `deno.land/std@0.168.0` + `esm.sh` imports.

Body in: `{ accessToken }`. Out: `ok({ subscriptions: [...] })`.

**Deltas from the reference:**

1. **Envelope.** `{ error: { kind, message } }`, never `{ success: false }` —
   the same fix every ported function needed; `supabase.rs`'s `to_error()`
   branches on `error.kind`.
2. **camelCase body.** `accessToken`, not `user_id`.
3. **The caller is proved, not asserted** — decision **B**. Reads
   `admin.from('subscriptions').eq('user_id', userData.user.id)` where the
   reference reads `eq('user_id', body.user_id)`.
4. **`razorpay_order_id` added to the select.** The reference's column list
   omits it; `Payment.reference` falls back to it
   (`razorpay_payment_id.or(razorpay_order_id)`) for a row that has an order
   but no captured payment yet. Nothing in this codebase's `verify-payment`
   currently inserts such a row — it only ever inserts once, with both ids
   already set — so this is a no-op today and a safety net if that ever
   changes (a webhook-based flow that records a `pending` row before
   capture, say).
5. `plans(name, duration)` kept from the reference verbatim even though
   `duration` maps to nothing on the Rust side yet — harmless (Rust ignores
   an unrecognised JSON field without `deny_unknown_fields`) and one field
   cheaper to leave in than to strip and re-add if the payment history ever
   grows a duration column.

Full column list: `id, amount, currency, status, start_date, end_date,
created_at, razorpay_order_id, razorpay_payment_id, payment_method,
plans(name, duration)`. `subscriptions.id` is read and ignored on the Rust
side the same way `duration` is — `Payment.id` is a synthetic 1-based row
number, not the uuid, and that stays true here.

`supabase/config.toml` gains `[functions.get-user-subscriptions]` with
`verify_jwt = false`, matching the other eight.

## Rust (`src-tauri/src/auth.rs`)

1. New wire shape, next to `ValidateResponse`/`LoginResponse`:

   ```rust
   #[derive(Debug, Deserialize)]
   struct SubscriptionsResponse {
       subscriptions: Vec<SubscriptionRow>,
   }
   ```

   `SubscriptionRow` is already exactly the right shape — same struct
   `fetch_current_subscription` deserialises today, same optional fields,
   same `plans(name)` embed. No change to it.

2. `auth_payments_impl` — replace the `supabase::select` call:

   ```rust
   async fn auth_payments_impl(app: AppHandle) -> AppResult<Vec<Payment>> {
       let Some(stored) = load_tokens(&app) else {
           return Err(AppError::NotFound("You are not signed in.".into()));
       };

       let response: SubscriptionsResponse = supabase::call_function(
           "get-user-subscriptions",
           &serde_json::json!({ "accessToken": stored.access_token }),
           "Could not load the payment history.",
       )
       .await?;

       Ok(response
           .subscriptions
           .into_iter()
           .enumerate()
           .map(|(index, row)| Payment { /* unchanged */ })
           .collect())
   }
   ```

   The `.map(...)` body is byte-for-byte what is there today (auth.rs:573–592)
   — only the fetch above it changes.

3. **`SUBSCRIPTION_COLUMNS` stays.** `fetch_current_subscription` still reads
   it directly over PostgREST (decision **C**), so the constant is not dead —
   it just loses `auth_payments_impl` as a second caller.

4. No change to `lib.rs` — `auth_payments` is already registered, and its
   signature does not change.

## Angular (`web/src/app`)

Nothing for the transport swap — `Payment`, `TAURI_COMMANDS.authPayments`,
`AuthBackend.payments()`, `TauriAuthBackend.payments()`,
`AuthService.payments()` and the table in `profile.html` are all already
correct for it, which is what decision **A** buys.

One line for decision **D**, in `Profile.selectPlan`'s success path
(profile.ts:377–383), beside the toast and the dialog close:

```ts
this.notify.success(/* … unchanged … */);
// The row `verify-payment` just wrote is not in the table yet — `load()`
// has not run since the constructor. The subscription card refreshed
// itself off the new session signal; this is what stops the history
// underneath it reading as though the payment never happened.
void this.load();
this.plansDialogOpen.set(false);
```

`load()` already sets `loading` and handles its own failure through
`notify.fromCommand`, so a re-fetch that fails after a *successful* payment
shows the ordinary "could not load the payment history" toast rather than
anything alarming — the payment is safe either way, and the next visit to
the screen fetches it again.

Deliberately not doing the more elaborate thing: `verify-payment` could
return the new row and the component could push it onto `payments()`
directly, saving a round trip. Not worth it — one extra call on a screen the
operator reaches a handful of times a year, against having two places that
know how a `subscriptions` row becomes a `Payment`.

## Docs to update in the same change

- **CLAUDE.md** — edge-function list gains `get-user-subscriptions` (eight →
  nine). The "Accounts / licensing" section's sentence about `create-order`
  and `verify-payment` carrying `accessToken` in the body gains
  `get-user-subscriptions` as a third example of the same pattern.
- **`supabase/README.md`** — one more function-table row, and the CLI deploy
  command's function list extended. Its closing paragraph currently reads
  "payments and profile reads while signed in go straight through PostgREST,
  protected by row level security instead" — **this becomes half wrong**:
  profile reads (`fetch_profile`, `fetch_current_subscription`) still do;
  payments no longer do. Needs rewording, not just an added row.
- **This file** — status line, once deployed.

## Verify

```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cd web && npm test -- --watch=false && npx ng build
```

Only one `web/` line changes (decision **D**), so the Angular build and
tests are close to a pure regression check here — the actual proof is on the
Rust side and, once deployed, in the running app.

Manual, once deployed:

1. Sign in on an account with at least one row in `subscriptions` (any
   status — a trial account with nothing purchased yet will correctly show
   an empty table, which is not a bug).
2. Open the profile. Payment history should show exactly the rows it showed
   before this change — same order, same reference numbers, same amounts.
   Nothing should look different; the point of this change is invisible to
   the operator.
3. Make a Razorpay payment (per `razorpay-payments.md`'s own manual pass).
   **Confirm the new row appears in the table without navigating away** —
   this is decision **D**, and it is the one behaviour here that is visibly
   different from before. Before this change the table stayed stale until
   the screen was rebuilt; after it, the row should be there by the time the
   toast fades.
4. Temporarily break `get-user-subscriptions` (wrong function name in
   `auth_payments_impl`, say) and confirm the profile shows the
   `profile.paymentsFailed` toast rather than a silent empty table — the
   error path was not something the reference or the port added tests for,
   worth eyeballing once.

## Deploy steps (yours)

1. Deploy `get-user-subscriptions`, Verify JWT **off**.
2. No new secrets — `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` are all already injected by the platform and
   already used by the other eight functions.
