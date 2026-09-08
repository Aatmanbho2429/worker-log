# Supabase setup

Accounts live in Supabase: `auth.users` holds the credentials, `public.users`
holds the profile and the licence, and the edge functions here are the only
things that write to either.

Everything below is done once, per project.

## 1. The schema

Run [`migrations/0001_account_schema.sql`](migrations/0001_account_schema.sql)
in the SQL editor. It adds one column and the row level security:

| What | Why |
| --- | --- |
| `users.company_name` | Collected on the register form; there was nowhere to put it. |
| RLS on `users`, `subscriptions`, `plans` | Select-only, and only your own rows. `plans` is the catalogue and is readable by anyone signed in. |

Nothing else. `subscriptions` already records what was bought, what it cost, how
it was paid and the term it covers — it *is* the payment history, and a separate
`payments` table would duplicate it and start disagreeing with it. `plans.name`
already holds the plan name, so a `plan` column on `users` would be a second
copy of a fact that changes when somebody upgrades.

There is deliberately **no** insert or update policy on any of them. Every write
goes through an edge function holding the service role key. If a signed-in user
could update their own row, they could clear `device_id` and move the licence to
another PC, or set `subscription_status` to `active` and stop paying — and if
they could insert a `subscriptions` row, they could write themselves a paid term
Razorpay never saw.

### Where the profile reads from

| Shown | Source |
| --- | --- |
| Status tag, days left, renewal date | `users.subscription_status`, `users.subscriptions_end_date` |
| Plan name, term start | The newest `active` row in `subscriptions`, joined to `plans` |
| Payment history | Every `subscriptions` row, newest first |

A trial has no `subscriptions` row at all — nothing was ordered and nothing was
paid — so the card falls back to the account's own dates and reads "Trial".

## 2. The functions

Each function is a single self-contained file with no shared imports, so you can
paste it straight into the dashboard (Edge Functions → Deploy a new function),
or deploy them with the CLI:

```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy register login validate-token send-otp forgot-password get-plans create-order verify-payment
```

If you paste them in the dashboard, turn **Verify JWT** off on all of them —
none can require a verified JWT, since either nobody is signed in yet or
(`get-plans`) nobody needs to be.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. `register`, `send-otp` and `forgot-password` send mail through
Resend, so they need one secret of their own:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
```

The sender is `Waste Log <noreply@pictoria.shop>`, hard-coded at the top of each
function — the same verified domain Pictoria sends from. The mailbox does not
have to exist; the domain does. `forgot-password` additionally reads
`RESEND_FROM` if you would rather set the sender as a secret there.

`create-order` and `verify-payment` need two secrets of their own, the same
Razorpay account for both:

```bash
supabase secrets set RAZORPAY_KEY_ID_PROD=rzp_xxxxxxxx
supabase secrets set RAZORPAY_KEY_SECRET_PROD=xxxxxxxxxxxxxxxx
```

The `_PROD` in both names is a naming choice carried over from where these
functions were ported from, not a guarantee of what is actually set — check
whether the key id reads `rzp_test_…` or `rzp_live_…` before assuming which
one a deploy is charging against.

| Function | Does | Deployed | JWT |
| --- | --- | --- | --- |
| `register` | Verifies the OTP against `email_otps`, refuses if this PC is already registered, then creates the auth user and the profile row keyed to it, with a 14-day trial on `users` and this PC's `device_id`. Deletes the auth user again if the profile insert fails, then sends the welcome email. | yes | not required |
| `login` | Signs in against GoTrue and decides the device binding on the server, claiming a null `device_id` on a first sign-in. `auth_login` calls this rather than GoTrue directly — see "Where the licence check happens" below. | yes | not required |
| `validate-token` | The six-hourly re-check `auth_validate` calls: still a real token, still this PC, still active, and whatever the subscription status now is — writing `expired` back to `public.users` if a term has run out since the last check. | yes | not required |
| `send-otp` | Mails a 4-digit code to prove an address before `register` is called with it. Rate-limited per address (one a minute, five an hour) in the function itself. | yes | not required |
| `forgot-password` | Rolls a password, emails it via Resend, then sets it. Never returns it. | not yet | not required |
| `get-plans` | The renewal catalogue shown on the profile once a subscription has expired or is close to it. Takes no token and needs none — a price list is not private, and the operator it exists for may hold one that is mid-refresh. | not yet | not required |
| `create-order` | Reads a plan's real price from `plans` and opens a Razorpay order against it. Refuses a `users.status` that is not `active`. Carries the operator's `accessToken` in the body, checked with `auth.getUser()` — never a bare `user_id`, which would hand back a name, email and phone for anyone who could guess a uuid. | not yet | not required |
| `verify-payment` | Recomputes the Razorpay HMAC signature server-side — the only place that check can happen — then records the paid term and unblocks the account. Refuses to insert a second row for a `razorpay_payment_id` already on file, so a retried call cannot extend the licence twice for one payment. | not yet | not required |

None of them can require a verified JWT: they are all called before anybody is
signed in, or (`get-plans`, `create-order`, `verify-payment`) check the
operator's token themselves rather than relying on the platform to. Each does
its own checking instead.

Every one of them needs the **service role key**, which cannot live in the
desktop binary — that is what makes each of these a function rather than a
PostgREST call with the anon key. `register` inserts a profile row and checks
this PC against every other account; `login` and `validate-token` read and
write the device binding and subscription status; `forgot-password` sets
somebody else's password; `get-plans` reads a table with no select policy for
an unauthenticated caller; `create-order` and `verify-payment` write to
`subscriptions` and `users`, which carry no insert or update policy for
anyone. Everything else Rust can do with the anon key and the user's own
credentials — payments and profile reads while signed in go straight through
PostgREST, protected by row level security instead.

## 3. The app

Nothing in `web/` knows Supabase exists. The Angular layer calls Tauri commands
and renders what comes back; the project URL, the anon key, the session tokens
and the licence check are all in [`src-tauri/src/supabase.rs`](../src-tauri/src/supabase.rs)
and [`src-tauri/src/auth.rs`](../src-tauri/src/auth.rs).

Both values are already filled in there, and both are overridable by
`SUPABASE_URL` / `SUPABASE_ANON_KEY` so a developer can point a build at their
own project without editing the source. The anon key is safe to compile in —
RLS is what protects the data. The service role key belongs only on the edge
functions.

Session tokens are written to `session.json` in the app data directory, **not**
into `worker-log.db`. Settings tells the operator that copying the database
backs the register up and moves it to another machine, and a backup carrying a
signed-in session would hand that session to whoever opened the copy.

## The welcome email

`register` sends one through Resend once the account is real, in the app's own
navy scheme: what Waste Log does, the trial and when it ends, the login address,
and a note that the licence is bound to this PC.

It is sent **last and non-fatally**. The account exists by then, so failing the
request because a mail did not go out would tell the operator that registration
failed when it did not — they would try again and be told the address is taken.
A refusal from Resend is logged and swallowed.

Names typed on the register form are HTML-escaped before they go into the
template, so a company name containing `<` cannot carry markup into an inbox.

## Where validation lives

In the register form, and only there. The functions store the body as they are
given it, which means a bad phone number or a short password reaching this
public endpoint by some route other than the app will be stored as sent.

The two checks that remain in `register` are not form validation and cannot move
to the client:

- **Is this PC already registered?** One machine carries one account. The front
  end cannot answer it — it would have to read every other user's `device_id`.
- **Is there a device id at all?** It comes from Rust, never from the form. Without
  one the account would be written bound to no machine.

## Where the licence check happens, and what that costs

`auth_login` (`src-tauri/src/auth.rs`) calls
[`functions/login/index.ts`](functions/login/index.ts) rather than signing in
against GoTrue directly: the function verifies the password and decides the
device binding on the server, handing back a session only once both pass. That
is a real server-side boundary — the anon key never leaves the client, but the
decision itself is made where nobody holding the binary can patch it.

`auth_validate` re-runs the same two checks — still a real token, still this
PC, still an active account — every six hours through
[`functions/validate-token/index.ts`](functions/validate-token/index.ts), and
both functions write `expired` back to `public.users` the moment a trial or a
paid term's end date has passed, rather than leaving that only computed for
display.

One thing Rust genuinely cannot do is **claim an unclaimed licence**: writing
`device_id` needs the service role key. Registration always claims the machine,
so a row with a null `device_id` at `login` means the account was made some
other way, and it is claimed rather than refused — the same first-machine rule
as registration. `validate-token` refuses instead: by the time a token exists
to validate, the account has already signed in once, so a null `device_id` at
that point means the row changed after the token was issued.

## Moving a licence to another PC

Null the column. The next machine to sign in claims it.

```sql
update public.users set device_id = null where email = 'someone@example.com';
```
