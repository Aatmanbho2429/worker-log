---
name: supabase
description: The account/licensing backend (separate from the local SQLite waste-log data). Use when touching auth.rs, supabase.rs, anything under supabase/, or the account/profile/subscription screens — registration, login, password reset/change, licence-to-device binding, or the payment-history view.
---

# Supabase: accounts & licensing

This is a **second, unrelated database** — real user accounts and licence
status — bolted onto an otherwise offline, single-SQLite-file app. Waste-log
data (`worker`, `series_of_product`, `worker_log`, …) never touches Supabase;
see `.claude/rules/data-model.md` for that half. This skill is only for the
account layer, and the login/register/profile screens.