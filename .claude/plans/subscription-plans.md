# Plan catalogue on the profile, and locking the app while expired

**Status: code complete (Rust + Angular + Supabase function file). Not yet
deployed** — `get-plans` needs pasting into the dashboard; see "Deploy steps"
at the bottom.

The six-hourly `auth_validate` tick already tells the app when a subscription
has run out. This plan is what the app does *with* that answer: send the
operator to the profile, show them what a renewal costs, and stop them
navigating anywhere else until it is fixed.

## Decisions made

- **A — `get-plans` edge function**, not a direct PostgREST read. Chosen
  deliberately over the cheaper option; see "Why a function" below for what it
  costs and what it buys.
- **B — the plan card's button is a no-op for now.** It renders enabled and
  does nothing. Razorpay is a later, separate piece of work. ~~Superseded~~ —
  the button now opens Razorpay's checkout; see `razorpay-payments.md`.
- **C — the nav hides while expired**, on top of the redirect `authGuard`
  already does. Floor and Masters sections disappear; Account (profile) and
  sign-out stay.
- **D — the catalogue shows only when `expired` or `expiring`.** An operator
  with months left sees the profile exactly as it is today, and `get-plans` is
  never called for them.
- **E — a `p-dialog`, not an inline card.** Superseded the first pass, which
  put the four plan cards straight into the page between the two-column block
  and the payment history. The subscription card now carries a "View plans"
  button instead (shown under the same **D** condition), and the dialog itself
  auto-opens once per session the first time `showPlans()` turns true — the
  same `plansLoaded` guard that used to gate only the fetch now gates the
  auto-open too, so closing the dialog does not reopen it; the button is how
  it is found again. `Profile.openPlansDialog()` also carries its own
  load-if-needed check, idempotent against the effect, for the edge case of a
  click landing before the effect has run.
- **F — a real pricing-tile layout, not a plain grid of text.** The first pass
  at the dialog was cramped and under-designed; redone as: a custom dialog
  header (`#header` template — eyebrow, title, the intro sentence, replacing
  the default one-line `[header]`), a dialog sized off the window (`90vw`
  capped at `78rem`) rather than a fixed rem, four columns stepping down to
  two at 1100px and one at 560px. `Profile.bestPlanId` picks the cheapest
  plan per day (not the longest term, which is not the same thing) and that
  card alone gets a "Best value" ribbon, a navy border, and a filled button
  where the other three are outlined.
- **G — after a screenshot review:** three fixes. The Monthly button had a
  visible focus ring that read as broken/misaligned — `p-dialog` defaults
  `focusOnShow` to true and, with no input field in this dialog to land on
  the way the password dialog's does, it autofocused the first "Choose plan"
  button instead; `[focusOnShow]="false"` on this dialog only. The per-day
  price line came out; `Profile.perDay()` and the `planPerDay` copy key went
  with it (`bestPlanId`'s own per-day *comparison* stays — only the display
  line was cut). Display order reversed to longest term first
  (`Profile.orderedPlans`, a `computed` that reverses `plans()` for the
  template only) — `get-plans` still answers in `sort_order` ascending
  (Monthly → Yearly), so `bestPlanId` and every other id-keyed read stay
  against the untouched order; only the `@for` in `profile.html` was pointed
  at the reversed one.

## What already exists — do not rebuild it

More than half of this is done. The gate itself works today:

| Needed | Already there |
| --- | --- |
| Knowing the term ran out | `build_subscription()` (auth.rs:287) computes `expired` / `expiring` from `subscriptions_end_date`, whatever the column says |
| Persisting it | `withCurrentSubscriptionStatus()` in `validate-token/index.ts` and `login/index.ts` writes `expired` back to `public.users` |
| Noticing without a restart | `AuthService.validate()` on `VALIDATE_INTERVAL_MS` (six hours) |
| Blocking every screen | `authGuard` redirects to `/profile` when `subscriptionExpired()` (auth.guard.ts:29) |
| Reading the plan name | `SUBSCRIPTION_COLUMNS` already joins `plans(name)` |
| Formatting money and dates | `Profile.money()` / `Profile.date()` |
| The expired/expiring banners | `profile.expiredMessage` / `profile.expiringMessage` in en.json |

So the genuinely new work is only: **fetch the catalogue**, **render it**, and
**hide the nav**. Nothing about expiry detection or the redirect changes.

## Why a function, when `plans` is already readable

Worth writing down, because the cheaper path is real and someone will ask.

`0001_account_schema.sql` grants `authenticated` a `select` policy on
`public.plans` — "the catalogue, the same for everyone" — so
`supabase::select("plans?...")` with the operator's own token would work
today, exactly the way `auth_payments` reads `subscriptions`. That would be
zero new files and nothing to deploy.

A function was chosen instead. What it buys: the catalogue read stops
depending on the operator holding a currently-valid token (an expired
operator is precisely the one who needs this screen, and their access token
may be mid-refresh), and there is one server-side seam to extend when the
Razorpay work lands — an order id, a current-plan flag, proration — rather
than a client-side query to rewrite then. What it costs: a sixth function to
paste into the dashboard and keep in sync.

Consequence for the design: because the function reads with the **service role
key**, it needs no token from the caller at all. So unlike every other
`auth_*` command, `auth_plans` does **not** call `load_tokens` and does not
fail when signed out. This is the one place that asymmetry is correct — a
price list is not private, and `supabase/README.md` already says the anon key
plus RLS is what protects everything that is.

## Edge function — `supabase/functions/get-plans/index.ts`

New file. Structurally a copy of `validate-token/index.ts`: same `ok` / `fail`
helpers, same `CORS_HEADERS` / `STATUS` tables, same `{ error: { kind, message } }`
envelope Rust's `to_error()` (supabase.rs:76) branches on. Self-contained, no
shared imports, pasteable into the dashboard.

- **Body in:** none. `POST` with an empty object; `supabase::call_function`
  always posts JSON, so it takes `{}` and ignores it.
- Read with the service role key:
  `admin.from('plans').select('id, name, duration, amount, currency').eq('is_active', true).order('sort_order', { ascending: true })`.
- **Out:** `ok({ plans: [...] })` — wrapped in an object rather than returned
  as a bare array, so a field can be added beside it later without changing
  the shape Rust deserialises.
- On a query error: `fail('internal', 'Could not load the plans.')`.

It is the most exposed of the six functions — no token, no rate limit — and
that is acceptable in a way it would not be for `send-otp`: it costs one
indexed read of a four-row table and returns a price list. Say so in the file
header comment, the way `config.toml` already reasons about `send-otp`.

`supabase/config.toml` gains `[functions.get-plans]` with `verify_jwt = false`,
matching the other five.

## Rust (`src-tauri/src`)

1. **`models/response/plan.rs`** — new, one struct per file per
   `.claude/rules/models.md`, `#[serde(rename_all = "camelCase")]`:

   ```rust
   pub struct Plan {
       pub id: String,        // uuid
       pub name: String,      // 'Monthly', 'Quarterly', …
       pub duration: i64,     // days: 30 / 90 / 180 / 365
       pub amount: f64,       // numeric(10,2) — same as SubscriptionRow.amount
       pub currency: String,  // 'INR'
   }
   ```

   `is_active` and `sort_order` are query criteria, not display data — they
   stay in the function. `amount` as `f64` follows the proven precedent:
   `SubscriptionRow.amount` already reads a `numeric` column this way and the
   payment history renders correctly from it.

2. **`models/response/mod.rs`** — re-export `Plan` (`models/mod.rs` re-exports
   flatly already, so `crate::models::Plan` then works).

3. **`auth.rs`** — the wire shape and the command, in the established
   `<name>_impl` + thin wrapper pair:

   ```rust
   #[derive(Debug, Deserialize)]
   struct PlansResponse { plans: Vec<Plan> }

   async fn auth_plans_impl() -> AppResult<Vec<Plan>> {
       let response: PlansResponse = supabase::call_function(
           "get-plans", &serde_json::json!({}), "Could not load the plans.").await?;
       Ok(response.plans)
   }
   ```

   Note there is no `AppHandle` parameter — nothing to load tokens from, per
   the decision above.

   `Plan` is deserialised directly off the wire here rather than mapped
   through a private `PlanRow`, unlike `ProfileRow` / `SubscriptionRow`. Those
   two exist so a column rename cannot silently change what the window is
   handed; this response is shaped by our own function, not by the table, so
   the indirection would buy nothing. Worth a comment saying so, since it
   breaks the file's pattern.

4. **`lib.rs`** — add `auth::auth_plans` to `generate_handler![]`. Nothing goes
   in `capabilities/default.json` (CLAUDE.md, "Adding a command touches exactly
   three places").

## Angular (`web/src/app`)

5. **`models/response/plan.ts`** — mirrors the Rust struct field-for-field.
6. **`models/response/index.ts`** — re-export it.
7. **`models/auth.ts`** — `export type { Plan } from './response/plan';`
   alongside the other account-domain re-exports, so screens keep importing the
   account domain from one place.
8. **`core/tauri/tauri-commands.const.ts`** — `authPlans: 'auth_plans'` under
   the auth block.
9. **`core/auth.backend.ts`** — `abstract plans(): Promise<Plan[]>;`
10. **`core/tauri-auth.backend.ts`** — implement via
    `zoneWrapper.invoke(TAURI_COMMANDS.authPlans)`.
11. **`core/auth.service.ts`** — `plans(): Promise<Plan[]>` delegating to the
    backend, same one-liner shape as `payments()`. No signal held here: the
    catalogue is one screen's data, not session state.

12. **`layout/shell/shell.ts`** — decision **C**. Tag the account section and
    filter:

    ```ts
    protected readonly visibleSections = computed(() =>
      this.auth.subscriptionExpired()
        ? this.sections.filter((section) => section.label === 'shell.sectionAccount')
        : this.sections,
    );
    ```

    `shell.html`'s `@for` loops `visibleSections()` instead of `sections`.
    Hiding rather than disabling: a disabled link still reads as "this app is
    broken" on the floor, where an empty nav plus the profile's banner reads as
    "the subscription lapsed". The guard is what actually enforces it — this is
    only so nobody clicks a link that silently bounces them back.

13. **`views/profile/profile.ts`** —
    - `plans = signal<Plan[]>([])`, `plansLoading = signal(false)`,
      `plansDialogOpen = signal(false)`.
    - `showPlans = computed(() => ['expired', 'expiring'].includes(this.subscription()?.status ?? ''))`
      — decision **D**, but now gates the "View plans" button rather than an
      inline section — decision **E**.
    - Load and auto-open from one `effect`, not the constructor: the
      six-hourly tick can flip the status to `expired` while the profile is
      already open, and an effect picks that up where a constructor call
      would leave the operator on a blocked screen with nothing telling them
      why. `plansLoaded` guards both the fetch and the auto-open so each
      fires once per session; closing the dialog does not reopen it.
    - `openPlansDialog()` — sets `plansDialogOpen` and, idempotently, loads if
      the effect has not already; wired to the subscription card's button.
    - `selectPlan(plan: Plan): void {}` — decision **B**. Empty, with a `//`
      line saying Razorpay goes here. This is the seam; the layout and the
      wiring are done so that work is only the handler.
    - Failure goes through `notify.fromCommand(error, t('profile.plansFailed'))`,
      same as `paymentsFailed`.

14. **`views/profile/profile.html`** — decisions **E** and **F**. A `p-button`
    ("View plans") on the subscription card, under the same
    `@if (showPlans())` the inline section used to sit behind, plus a
    `p-dialog` (`[style]="{ width: '90vw', maxWidth: '78rem' }"`, modal,
    non-draggable — same shape as the change-password dialog, but a window-
    relative width rather than that dialog's fixed `38rem`, since a pricing
    grid needs the room a form does not) bound to `plansDialogOpen`. Its
    `#header` template replaces the plain `[header]` string with an eyebrow +
    title + intro sentence, matching the subscription card's own
    eyebrow/heading pattern. `[focusOnShow]="false"` — decision **G**.
    Longest term first (`orderedPlans()`, decision **G**): four cards in a
    grid — name, the price with the term beside it, and the button — each
    wrapped one level further than a bare grid cell so the "Best value" card
    can carry a ribbon and an accent border. `p-skeleton` tiles while
    loading, laid out in the same grid as the real cards so nothing reflows
    when they resolve — a plain stacked `.skeletons` list (the payment
    table's treatment) would have jumped on load.
15. **`views/profile/profile.scss`** — the grid: four columns at the dialog's
    full width, stepping to two at 1100px and one at 560px. Viewport media
    queries are the right tool here after all — unlike a browser tab, this
    app's "viewport" is the one Tauri window the dialog is centered in, so a
    breakpoint tracks the actual room available; the 1100px step matters
    because the app's own 1024px minimum window width sits just under it,
    so the narrowest the window can go always reads as two columns rather
    than a cramped four. The "Best value" ribbon and border use `$band` /
    `$band-text` (fixed navy-on-white in both themes, the same pair the
    active reason chip already uses in `waste.scss`) rather than
    `$text-accent`, which is chosen to work as *text on the page* and is not
    guaranteed dark enough for white text to sit on as a fill in the dark
    theme. Colours come from `_tokens.scss` only (`.claude/rules/theming.md`);
    no hex in the file.

## Copy (`web/src/assets/i18n/en.json`)

New keys under the existing `profile.*` namespace — no new namespace, and
nothing hardcoded in the template (`.claude/skills/extract-static-text`):
`viewPlans`, `planSectionTitle`, `planSectionBody`, `planDuration`
(`"{{ days }} days"`), `planChoose`, `bestValue`, `plansFailed`, `noPlans`.
`subscriptionStatus.*` already covers the status tag. (`planPerDay` existed
briefly for the per-day price line — decision **G** cut both.)

## Docs to update in the same change

- **CLAUDE.md** — done: command count 39 → 40 (two places), "nine `auth_*`
  commands" → ten (two places), the edge-function list gains `get-plans` (five
  → six), and the "Accounts / licensing" section now describes the nav hiding
  and the plans card rather than just the redirect.
- **`supabase/README.md`** — done: the function table now lists all six
  (it previously documented three), the `login`-is-unused claim and the
  "written but not deployed" claim in "Where the licence check happens" are
  both fixed (both were already wrong before this change — `login_via_edge`
  landed earlier), and the Resend secret note now includes `send-otp`.
- **This file** — status line, done. Still needed once `get-plans` is
  deployed: the manual test pass below, and flipping this line again.

## Verify

```bash
cargo build --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cd web && npm test -- --watch=false && npx ng build
npx prettier --write src/app/...   # web/ only — supabase/ isn't prettier-managed
```

Run — all green: `cargo build` clean with no warnings, `cargo test` 32 passed
(2 ignored, pre-existing), `npm test -- --watch=false` 37 passed (no new unit
tests added — this adds a fetch, a template and a filter, and nothing under
`views/` or `services/` was covered before this either), `npx ng build`
produced a `profile` chunk with no type or template errors. Every touched
`web/` file was already Prettier-clean; `auth.rs` was not `cargo fmt`-clean
before this change either (pre-existing, unrelated to what was added here) —
confirmed the new code (`PlansResponse`, `auth_plans_impl`, `auth_plans`)
introduces no diff of its own, and left the rest of the file alone rather than
reformatting code this change didn't touch.

Manual, once deployed (not yet done — needs `get-plans` pasted in first):

1. Sign in on an account with a live subscription — profile looks exactly as
   before, no "View plans" button, no dialog, nav intact.
2. Set `subscriptions_end_date` to yesterday in the dashboard. Restart (or wait
   for the tick). Expect: redirected to `/profile`, Floor and Masters gone from
   the nav, expired banner, and the plans dialog **auto-opens** with four cards
   in `sort_order` — Monthly ₹499 / 30 days through Yearly ₹3,999 / 365 days.
   Clicking a plan's button does nothing. Close the dialog, then click "View
   plans" on the subscription card — reopens with the same four cards, no
   second fetch (watch the network tab or add a temporary log in `loadPlans`).
3. Try navigating to `/waste` by URL — bounced back to `/profile`.
4. Set the end date a week out. Expect: `expiring`, the warning banner, the
   "View plans" button still there (no auto-open a second time this session),
   and the nav **back** — expiring does not block.
5. Sign out and back in — same result, since `login` writes the status too;
   a fresh session auto-opens the dialog again on first landing.

## Deploy steps (yours)

1. Deploy `get-plans`, Verify JWT **off**.
2. No new secrets — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected
   by the platform.
3. Confirm the four rows from the `INSERT` are in `public.plans` with
   `is_active = true` and `sort_order` 1–4.
