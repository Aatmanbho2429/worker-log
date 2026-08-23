# Ceramic Waste Log

A replacement for the paper waste register kept on a sanitaryware line: who lost
a piece, where it was lost, and whether it came off the line as grade 3 or
grade 4. At the end of the month it prints back out as the same sheet.

```
worker-log/
├── server/   Rust API + local SQLite database
└── web/      Angular 21 + PrimeNG front end
```

## What it does

- **Waste log** — pick the reason a piece was lost to, then tap grade 3 or
  grade 4 against the worker. Counts update instantly; a minus button beside
  each count undoes a mis-tap.
- **Month sheet** — the paper register on screen: workers down, a 3rd/4th
  column pair per reason across, totals on every edge.
- **Reports** — totals for the period, a breakdown by reason, the workers with
  the most waste, the full entry history, and the PDF/CSV exports.
- **Masters** — CRUD for workers, series of product and reasons.

Every screen shares one date range (defaulting to the current month) and an
optional series filter.

## Data model

| Table | Columns |
| --- | --- |
| `series_of_product` | id, name, created_date, modified_date |
| `reason` | id, name, sort_order, created_date, modified_date |
| `worker` | id, first_name, last_name, phone (optional), series_of_product_id, created_date, modified_date |
| `worker_log` | id, worker_id, grade3, grade4, reason_id, created_date, modified_date |

Each tap of a grade button writes **one** `worker_log` row (`grade3 = 1` or
`grade4 = 1`) rather than incrementing a counter. Counts on every screen are a
`SUM` over the selected range. That keeps a per-entry audit trail — visible
under Reports → Entry history — and makes an undo a single row delete.

`reason.sort_order` is the left-to-right order of the columns on the sheet and
the PDF; it is editable from the Reasons screen.

## Running it

Two processes. The API first:

```bash
cd server
cargo run              # http://localhost:8080, writes ./worker-log.db
```

Then the front end, which proxies `/api` to it:

```bash
cd web
npm install
npm start              # http://localhost:4200
```

On first start the database is created and seeded with the reason columns from
the paper sheet (Karigar, Other, Loader, Bhatthi, Handling, Kachu, Repair,
Glazing, Pressure, Sorting). Rename them from the Reasons screen to match your
own sheet — seeding only ever happens on an empty table.

### Demo data

To see the app with a register behind it rather than empty screens:

```bash
cd server
cargo run -- seed
```

That writes 4 product series, 24 workers and roughly 700–800 waste entries
spread from the **first of last month to today**, so the date filters, the
"Last month" preset and the PDF export all have a full sheet to show. Sundays
are left clear, entries land inside shift hours, and the reasons are weighted
— handling and the loader break the most pieces, glazing faults are rare — so
the report's breakdown has a realistic shape rather than being flat noise.

It refuses to touch a database that already has workers in it. Pass `--force`
to clear the waste log, workers and series first and start over:

```bash
cargo run -- seed --force
```

Reasons survive a `--force` reseed, since by then you may have renamed them to
match your own register. The generator is deterministic, so a fresh database
always seeds the same demo.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORKER_LOG_DB` | `worker-log.db` | SQLite file path |
| `WORKER_LOG_PORT` | `8080` | API port |
| `WORKER_LOG_LOG` | `worker_log=info` | `tracing` filter |

Run `cargo run -- --help` for the command list.

Timestamps are stored in the server's **local** time, because the floor files
the sheet by its own calendar day — an entry logged at 9pm has to land on that
day's report. Set `TZ` on the host if the server is not in the factory's zone.

### Production

```bash
cd web && npm run build     # dist/CeramicWasteLog/browser
cd server && cargo build --release
```

Serve the built front end from any static host pointed at the API, or put both
behind one reverse proxy on `/` and `/api`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | liveness |
| `GET POST` | `/api/series` | list / create |
| `GET PUT DELETE` | `/api/series/{id}` | read / update / delete |
| `GET POST` | `/api/reasons` | list / create |
| `GET PUT DELETE` | `/api/reasons/{id}` | read / update / delete |
| `GET POST` | `/api/workers` | list (`?seriesId=`) / create |
| `GET PUT DELETE` | `/api/workers/{id}` | read / update / delete |
| `GET` | `/api/workers/{id}/impact` | entries a delete would remove |
| `GET` | `/api/waste/dashboard` | the worker × reason grid |
| `GET POST` | `/api/waste/logs` | history / record one tap |
| `POST` | `/api/waste/logs/undo` | remove the most recent matching tap |
| `GET` | `/api/reports/waste-log.pdf` | the month sheet as PDF |
| `GET` | `/api/reports/waste-log.csv` | the same data as CSV |

Range endpoints take `?from=YYYY-MM-DD&to=YYYY-MM-DD&seriesId=`; both dates are
inclusive and default to the current month.

Deletes are guarded: a series with workers on it and a reason with waste logged
against it both return `409` rather than orphaning data. Deleting a *worker*
does cascade to their waste entries, so the confirmation says how many.

## Exports

`GET /api/reports/waste-log.pdf` renders the sheet in landscape — Sr, worker,
item/series, then a 3rd/4th pair per reason and a trailing total pair, with a
totals row on the last page. It steps up from A4 to A3 automatically when there
are enough reasons to squeeze the boxes, and paginates at ~27 workers a page.

The PDF is written by a small self-contained writer (`server/src/pdf.rs`) using
the base-14 Helvetica fonts, so nothing has to ship beside the binary. Those
fonts are Latin-only: **names typed in Gujarati render as `?` on the PDF**. The
CSV export is UTF-8 with a BOM and keeps them intact, so use CSV if the sheet
has to carry Gujarati names.

## Tech

Angular 21 standalone components with signals and zone.js change detection
(event + run coalescing), PrimeNG 21 on a custom dark navy Aura preset, SCSS
with a shared token file. Rust with axum, rusqlite (bundled SQLite) and chrono;
a single guarded connection, which suits one terminal on one shop floor.
