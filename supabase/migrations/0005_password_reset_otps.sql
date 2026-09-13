-- The one-time codes that prove an email address belongs to whoever is
-- asking to reset the password on it, from the login screen's "Forgot
-- password?" dialog.
--
-- A copy of `0002_email_otps.sql`'s table, kept separate rather than shared:
-- `send-otp` refuses an address that already has an account, and this flow
-- accepts only addresses that do, so the two would rarely collide on one
-- table — but sharing it would still let `register`'s code check see a reset
-- code, and would tie both flows' cooldowns and attempt counters together. A
-- second table makes that impossible rather than merely unlikely.
--
-- Run this once, in the SQL editor of your Supabase project.

-- ----------------------------------------------------------------- table --

-- One row per address, not one per code. The primary key on `email` is what
-- makes "a new code invalidates the previous one" fall out of a plain upsert:
-- there is only ever one live code for an address, so a second request cannot
-- leave an older code still working behind it.
--
-- The rate-limit columns live on the same row deliberately.
-- `forgot-password-send-otp` has to read the cooldown, the hourly window and
-- the current code in one round trip before it decides anything, and
-- splitting them across tables would buy nothing but a join.
create table if not exists public.password_reset_otps (
  email        text primary key,

  -- SHA-256 of `email:code:PEPPER`, never the code itself. A dump of this
  -- table is then not a list of live codes, and the pepper (which lives in
  -- the function's secrets, not the database) has to leak too before the
  -- 4-digit space could be walked offline.
  code_hash    text        not null,

  expires_at   timestamptz not null,

  -- Wrong guesses against the current code. `forgot-password-verify-otp`
  -- gives up at 5 and deletes the row, so a 4-digit code cannot be
  -- brute-forced online.
  attempts     integer     not null default 0,

  -- Cooldown between sends (one minute).
  last_sent_at timestamptz not null default now(),

  -- Sends inside the current hour, and when that hour started. Together they
  -- cap one address at 5 codes an hour so nobody can be mail-bombed by
  -- somebody else typing their address into the form.
  --
  -- The default is never used: `forgot-password-send-otp` computes and writes
  -- both columns on every upsert. It is 0 rather than 1 only so a row created
  -- by hand starts from a clean count.
  send_count   integer     not null default 0,
  window_start timestamptz not null default now()
);

-- Expired rows are harmless — every reader checks `expires_at`, and the next
-- send for that address overwrites the row. They are only clutter. If the
-- table ever grows enough to matter, sweep it:
--
--   delete from public.password_reset_otps where expires_at < now() - interval '1 day';

-- ------------------------------------------------------------------- RLS --

alter table public.password_reset_otps enable row level security;

-- Deliberately no policies at all, matching `users` / `subscriptions` /
-- `plans` / `email_otps`: every read and write goes through an edge function
-- holding the service role key, which bypasses RLS.
--
-- This table needs that more than most. A select policy would hand out
-- `code_hash` and `expires_at` for any address; an insert or update policy
-- would let somebody reset `attempts` to zero and guess a 4-digit code
-- forever. Nobody signed in has any business reading this table, and nobody
-- is signed in at the point it is used.
