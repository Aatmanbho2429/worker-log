-- Grades become rows rather than columns.
--
-- The sheet has always tracked exactly two — grade 3 (salvage) and grade 4
-- (scrap) — as a pair of integer columns on `worker_log`. A factory that
-- wants a third has no way to ask for one without a schema change, so the
-- grades move into their own master table and `worker_log` carries a
-- `grade_id` instead. One tap is still one row; only which column names the
-- grade has changed.

CREATE TABLE IF NOT EXISTS grade (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    created_date  TEXT NOT NULL,
    modified_date TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_grade_name ON grade (name COLLATE NOCASE);

-- Seeded with the ids 3 and 4 on purpose, not as an accident of insertion
-- order: the barcode payload carries the grade id in the digit that used to
-- carry the grade number, so pinning them here is what keeps a sheet printed
-- before this change scanning afterwards. See `barcode.rs`.
INSERT INTO grade (id, name, created_date, modified_date)
SELECT 3, 'Grade 3', datetime('now', 'localtime'), datetime('now', 'localtime')
 WHERE NOT EXISTS (SELECT 1 FROM grade WHERE id = 3);

INSERT INTO grade (id, name, created_date, modified_date)
SELECT 4, 'Grade 4', datetime('now', 'localtime'), datetime('now', 'localtime')
 WHERE NOT EXISTS (SELECT 1 FROM grade WHERE id = 4);

-- --------------------------------------------------------------------------
-- worker_log: grade3 / grade4 -> grade_id

CREATE TABLE worker_log_migrated (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id     INTEGER NOT NULL REFERENCES worker (id) ON DELETE CASCADE,
    reason_id     INTEGER NOT NULL REFERENCES reason (id) ON DELETE RESTRICT,
    grade_id      INTEGER NOT NULL REFERENCES grade (id) ON DELETE RESTRICT,
    created_date  TEXT NOT NULL,
    modified_date TEXT NOT NULL
);

-- Both writers only ever wrote a single unit per row, but a count of two would
-- otherwise be silently rounded down to one entry, so the copy expands each
-- old row into as many new rows as it was counting.
INSERT INTO worker_log_migrated (worker_id, reason_id, grade_id, created_date, modified_date)
WITH RECURSIVE units(i) AS (
    SELECT 1
    UNION ALL
    SELECT i + 1 FROM units
     WHERE i < (SELECT MAX(MAX(grade3), MAX(grade4)) FROM worker_log)
)
SELECT l.worker_id, l.reason_id, 3, l.created_date, l.modified_date
  FROM worker_log l JOIN units ON units.i <= l.grade3
UNION ALL
SELECT l.worker_id, l.reason_id, 4, l.created_date, l.modified_date
  FROM worker_log l JOIN units ON units.i <= l.grade4;

DROP TABLE worker_log;
ALTER TABLE worker_log_migrated RENAME TO worker_log;

CREATE INDEX IF NOT EXISTS ix_worker_log_worker  ON worker_log (worker_id);
CREATE INDEX IF NOT EXISTS ix_worker_log_reason  ON worker_log (reason_id);
CREATE INDEX IF NOT EXISTS ix_worker_log_grade   ON worker_log (grade_id);
CREATE INDEX IF NOT EXISTS ix_worker_log_created ON worker_log (created_date);

-- --------------------------------------------------------------------------
-- barcode: one printed code per grade button

-- A row per worker x reason x grade, which is exactly the set of grade buttons
-- the waste screen draws. The codes were derived from the ids on demand
-- before; storing them means the sheet, the PDF and the reader all read the
-- same row, and a scan resolves by lookup rather than by decoding.
CREATE TABLE IF NOT EXISTS barcode (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode       TEXT NOT NULL,
    worker_id     INTEGER NOT NULL REFERENCES worker (id) ON DELETE CASCADE,
    reason_id     INTEGER NOT NULL REFERENCES reason (id) ON DELETE CASCADE,
    grade_id      INTEGER NOT NULL REFERENCES grade (id) ON DELETE CASCADE,
    created_date  TEXT NOT NULL,
    modified_date TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_barcode_value  ON barcode (barcode);
CREATE UNIQUE INDEX IF NOT EXISTS ux_barcode_button ON barcode (worker_id, reason_id, grade_id);
CREATE INDEX IF NOT EXISTS ix_barcode_worker ON barcode (worker_id);
CREATE INDEX IF NOT EXISTS ix_barcode_reason ON barcode (reason_id);
