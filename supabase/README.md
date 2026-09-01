# Supabase setup

Accounts live in Supabase: `auth.users` holds the credentials, `public.users`
holds the profile and the licence, and the three edge functions here are the
only things that write to either.

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
supabase functions deploy register login forgot-password
```

If you paste them in the dashboard, turn **Verify JWT** off on all three — they
are all called before anybody is signed in.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. Both `register` and `forgot-password` send mail through Resend,
so they need one secret of their own:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
```

The sender is `Waste Log <noreply@pictoria.shop>`, hard-coded at the top of each
function — the same verified domain Pictoria sends from. The mailbox does not
have to exist; the domain does. `forgot-password` additionally reads
`RESEND_FROM` if you would rather set the sender as a secret there.

| Function | Does | Deployed | JWT |
| --- | --- | --- | --- |
| `register` | Refuses if this PC is already registered, then creates the auth user and the profile row keyed to it, with a 14-day trial on `users` and this PC's `device_id`. Deletes the auth user again if the profile insert fails, then sends the welcome email. | yes | not required |
| `forgot-password` | Rolls a password, emails it via Resend, then sets it. Never returns it. | not yet | not required |
| `login` | Written, but **not used**. Rust signs in against GoTrue directly — see below. | no | not required |

None of them can require a verified JWT: they are all called before anybody is
signed in. Each does its own checking instead.

Only `register` and `forgot-password` need to exist as functions at all, and for
the same reason: both need the **service role key**, which cannot live in the
desktop binary. Registration inserts a profile row and checks this PC against
every other account; a password reset sets somebody else's password. Everything
else Rust can do with the anon key and the user's own credentials.

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

Rust signs in against GoTrue directly, reads the profile through PostgREST, and
compares `device_id` with the machine id it reads off the hardware. That is a
real boundary — the check is compiled, and the anon key and tokens never reach
the window — but it is not a server-side one. Someone determined enough to patch
the binary could skip it.

The stronger version is [`functions/login/index.ts`](functions/login/index.ts),
which verifies the password and decides the binding on the server and hands back
a session only once both pass. It is written and typechecked but not deployed.
Deploy it and point `auth_login` at it to close that gap.

One thing Rust genuinely cannot do is **claim an unclaimed licence**: writing
`device_id` needs the service role key. Registration always claims the machine,
so a row with a null `device_id` means the account was made some other way —
`auth_login` refuses it and asks the operator to contact support.

## Moving a licence to another PC

Null the column. The next machine to sign in claims it.

```sql
update public.users set device_id = null where email = 'someone@example.com';
```
