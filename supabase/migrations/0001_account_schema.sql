-- The one column the account screens need that `public.users` does not carry,
-- and the row level security for the four tables they read.
--
-- Run this once, in the SQL editor of your Supabase project.

-- ---------------------------------------------------------------- columns --

-- Collected on the register form. The default is only there so the statement
-- succeeds against a table that already has rows in it; every row written from
-- here on carries a real one.
alter table public.users
  add column if not exists company_name text not null default '';

-- Nothing else is added. `subscriptions` already records what was bought, what
-- it cost, how it was paid and the term it covers, and `plans.name` already
-- holds the plan name — a `plan` column on `users` would be a second copy of a
-- fact that changes when somebody upgrades.

-- If you ran an earlier draft of this file that created `public.payments`,
-- that table is redundant now. Check it is empty, then drop it:
--
--   drop table if exists public.payments;

-- ------------------------------------------------------------------- RLS --

alter table public.users enable row level security;
alter table public.subscriptions enable row level security;
alter table public.plans enable row level security;

-- Read-only, and only your own row.
drop policy if exists "users read own row" on public.users;
create policy "users read own row"
  on public.users for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "subscriptions read own" on public.subscriptions;
create policy "subscriptions read own"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

-- The profile joins a subscription to its plan to show the plan's name, so the
-- plan list has to be readable. There is nothing private in it — it is the
-- catalogue, the same for everyone.
drop policy if exists "plans readable" on public.plans;
create policy "plans readable"
  on public.plans for select
  to authenticated
  using (true);

-- There is deliberately NO insert, update or delete policy on any of these.
--
-- Every write goes through an edge function holding the service role key,
-- which bypasses RLS. That is the point: if a signed-in user could update
-- their own row they could clear `device_id` and move the licence to another
-- PC, or set `subscription_status` to 'active' and give themselves a free
-- one. Granting an update policy here would undo both of the things this
-- schema exists to enforce. The same goes for `subscriptions` — a user who
-- could insert one could write themselves a paid term that Razorpay never saw.
