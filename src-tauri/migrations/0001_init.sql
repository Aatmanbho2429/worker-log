PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS series_of_product (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    created_date  TEXT NOT NULL,
    modified_date TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_series_name
    ON series_of_product (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS reason (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_date  TEXT NOT NULL,
    modified_date TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_reason_name
    ON reason (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS worker (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name           TEXT NOT NULL,
    last_name            TEXT NOT NULL,
    phone                TEXT,
    series_of_product_id INTEGER NOT NULL
                         REFERENCES series_of_product (id) ON DELETE RESTRICT,
    created_date         TEXT NOT NULL,
    modified_date        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_worker_series ON worker (series_of_product_id);

-- One row per tap of a grade button. Counting is a SUM over the range rather
-- than a mutable counter, so an accidental tap is undone by deleting its row
-- and the audit trail of who was logged when survives.
CREATE TABLE IF NOT EXISTS worker_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id     INTEGER NOT NULL REFERENCES worker (id) ON DELETE CASCADE,
    grade3        INTEGER NOT NULL DEFAULT 0,
    grade4        INTEGER NOT NULL DEFAULT 0,
    reason_id     INTEGER NOT NULL REFERENCES reason (id) ON DELETE RESTRICT,
    created_date  TEXT NOT NULL,
    modified_date TEXT NOT NULL,
    CHECK (grade3 >= 0 AND grade4 >= 0),
    CHECK (grade3 + grade4 > 0)
);

CREATE INDEX IF NOT EXISTS ix_worker_log_worker  ON worker_log (worker_id);
CREATE INDEX IF NOT EXISTS ix_worker_log_reason  ON worker_log (reason_id);
CREATE INDEX IF NOT EXISTS ix_worker_log_created ON worker_log (created_date);
