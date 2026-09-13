-- The pointer from an account to the `subscriptions` row its licence is
-- currently running on. Stores which row, not a copy of the plan name or
-- dates — `0001_account_schema.sql` already argues against a `plan` column
-- on `users` for exactly that reason; this is a foreign key, not a copy.
--
-- Run this once, in the SQL editor of your Supabase project. Idempotent, like
-- `0003_payments.sql` — safe to run again.

-- ---------------------------------------------------------------- columns --

alter table public.users
  add column if not exists current_subscription_id uuid;

-- Named explicitly: the edge functions' embed hint refers to it by name, and
-- it has to be unambiguous because `subscriptions.user_id → users.id` already
-- links the same two tables in the other direction.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_current_subscription_id_fkey'
  ) then
    alter table public.users
      add constraint users_current_subscription_id_fkey
      foreign key (current_subscription_id)
      references public.subscriptions (id)
      on delete set null;
  end if;
end $$;

-- --------------------------------------------------------------- backfill --

-- Each account points at its active term with the latest end date — the same
-- rule `fetch_current_subscription` used to infer client-side. Only fills
-- nulls, so a re-run never overwrites a pointer `verify-payment` has since
-- set explicitly.
update public.users u
set current_subscription_id = s.id
from (
  select distinct on (user_id) id, user_id
  from public.subscriptions
  where status = 'active'
  order by user_id, end_date desc nulls last
) s
where s.user_id = u.id
  and u.current_subscription_id is null;

-- No RLS policy is added here. Every read of this column goes through
-- `login` / `validate-token` with the service role key — see
-- `.claude/skills/supabase/payments.md`.
