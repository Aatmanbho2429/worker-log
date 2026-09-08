-- What `verify-payment` needs that `public.subscriptions` may not already
-- have. `0001_account_schema.sql` never created this table — it predates
-- that migration — so this one is written to be correct whether or not the
-- column already exists.
--
-- Run this once, in the SQL editor of your Supabase project.

-- ---------------------------------------------------------------- columns --

-- The reference implementation this was ported from writes this on every
-- row; `auth.rs` has never read it, so there was nothing forcing it to exist
-- here already.
alter table public.subscriptions
  add column if not exists razorpay_signature text;

-- --------------------------------------------------------------- indexes --

-- One payment can only ever buy one term. Without this, a `verify-payment`
-- call that runs twice for one real payment — a retry after a network blip
-- on the client, say — would insert a second row and extend the licence a
-- second time for money that changed hands once. `verify-payment` itself
-- checks for the existing row first and returns early; this index is the
-- backstop for the case where two such calls land close enough together to
-- race each other past that check.
--
-- Partial rather than a plain unique constraint: a row written by hand, or
-- a future trial row, carries no Razorpay payment id at all, and those must
-- not be treated as duplicates of one another.
create unique index if not exists subscriptions_razorpay_payment_id_key
  on public.subscriptions (razorpay_payment_id)
  where razorpay_payment_id is not null;
