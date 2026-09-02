---
paths:
  - "src-tauri/src/repo/**/*.rs"
  - "src-tauri/migrations/**/*.sql"
---

# Waste-log data rules

- A grade-button tap writes one `worker_log` row; never collapse taps into a
  counter column. Counts everywhere are a `COUNT` over the selected date
  range, grouped by grade — that's what keeps a full audit trail (Reports →
  Entry history) and makes undo a single row delete.
- Deletes that would orphan history are refused, not silently cascading: a
  series with workers on it, a reason or grade with waste logged against it,
  and the last remaining grade are all refused with a `Conflict`/`BadRequest`
  `AppError` telling the operator to rename instead. Deleting a *worker* is
  the one cascade that's allowed (their `worker_log` rows go with them) — the
  confirmation must say how many rows that takes.
- `barcode` holds one row per worker × reason × grade button. Creating a
  worker, reason, or grade must backfill the missing `barcode` rows (also
  redone on startup) — the grid must never be partly covered.
- New migrations go in `src-tauri/migrations/` as the next numbered file,
  tracked by `PRAGMA user_version`, each its own transaction, written so
  re-running it over an already-migrated database is a no-op (`IF NOT EXISTS`
  style) — a register from before the pragma was introduced reports version 0.
