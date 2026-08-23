# Ceramic Waste Log

A desktop replacement for the paper waste register kept on a sanitaryware line:
who lost a piece, where it was lost, and whether it came off the line as grade 3
or grade 4. At the end of the month it prints back out as the same sheet.

Ships as a native application — Tauri shell, Angular UI, Rust core, SQLite file.
No server to run, no browser, no network.

```
worker-log/
├── package.json   Root — `npm run dev` / `npm run build`
├── src-tauri/     Rust: Tauri commands, SQLite, PDF writer
└── web/           Angular 21 + PrimeNG front end
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
- **Settings** — where the database file lives, and the demo data loader.

Every screen shares one date range (defaulting to the current month) and an
optional series filter.

## Building and running

You need [Node](https://nodejs.org), [Rust](https://rustup.rs), and Tauri's
platform prerequisites — on Linux that is `libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `librsvg2-dev` and `patchelf`; on Windows the WebView2 runtime
and MSVC build tools; on macOS the Xcode command line tools. See
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install       # once — the Tauri CLI
npm run setup     # once — the Angular front end's dependencies

npm run dev       # opens the app, with the UI hot-reloading
npm run build     # produces the installers
```

`npm run dev` starts the Angular dev server and the Tauri window together and
tears both down when the window closes; there is no port to leave orphaned.

`npm run build` writes the executable to
`src-tauri/target/release/` and installers to
`src-tauri/target/release/bundle/` — `.deb` and `.AppImage` on Linux, `.msi`
and an NSIS `.exe` on Windows, `.dmg` on macOS. Each platform's installers must
be built on that platform.

### Where the data lives

One SQLite file in the OS per-user app data directory:

| Platform | Path |
| --- | --- |
| Linux | `~/.local/share/com.aatman.ceramicwastelog/worker-log.db` |
| Windows | `%APPDATA%\com.aatman.ceramicwastelog\worker-log.db` |
| macOS | `~/Library/Application Support/com.aatman.ceramicwastelog/worker-log.db` |

Settings shows the exact path. Copy that one file to back the register up or
move it to another machine. `WORKER_LOG_DB` overrides the location, which is
what the dev workflow uses.

Timestamps are stored in **local** time, because the floor files the sheet by
its own calendar day — an entry logged at 9pm has to land on that day's report.

### Demo data

On first run the database is created and seeded with the reason columns from
the paper sheet (Karigar, Other, Loader, Bhatthi, Handling, Kachu, Repair,
Glazing, Pressure, Sorting). Rename them from the Reasons screen to match your
own sheet — that seeding only ever happens on an empty table.

To see the app with a register behind it rather than empty screens, open
**Settings → Load demo data**. It writes 4 product series, 24 workers and
roughly 750 waste entries spread from the **first of last month to today**, so
the date filters, the "Last month" preset and the exports all have a full sheet
to show. Sundays are left clear, entries land inside shift hours, and the
reasons are weighted — handling and the loader break the most pieces, glazing
faults are rare — so the report's breakdown has a realistic shape rather than
being flat noise.

Loading only works on an empty register. **Replace everything with demo data**
clears the waste log, workers and series first. Reasons survive, since by then
you may have renamed them to match your own register. The generator is
deterministic, so a fresh database always seeds the same demo.

## How the two halves talk

There is no HTTP. The Angular side calls Rust through Tauri's IPC, and Rust
pushes events back.

**Commands** (`web/src/app/core/waste-log.service.ts` → `src-tauri/src/commands.rs`):

| Command | Purpose |
| --- | --- |
| `app_info` | version and database path |
| `list_series` `create_series` `update_series` `delete_series` | series CRUD |
| `list_reasons` `create_reason` `update_reason` `delete_reason` | reason CRUD |
| `list_workers` `create_worker` `update_worker` `delete_worker` | worker CRUD |
| `worker_delete_impact` | entries a delete would remove |
| `waste_dashboard` | the worker × reason grid |
| `waste_logs` | the entry history |
| `add_waste_entry` `undo_waste_entry` | record / remove one tap |
| `export_waste_pdf` `export_waste_csv` | write the sheet to a chosen path |
| `seed_demo_data` | load the demo register |

A rejected command resolves to `{ kind, message }`, where `kind` is
`badRequest`, `notFound`, `conflict` or `internal`. The front end shows the
first three as warnings the operator can act on and the last as a fault.

**Events.** Every command that writes emits `worker-log://data-changed` with
the scope that moved (`waste`, `workers`, `series`, `reasons`, `everything`),
and each screen reloads only for the scopes it cares about. The waste screen
deliberately ignores `waste`: its own taps are the only source of those, its
optimistic state is already correct, and reloading mid-burst would fight the
operator.

### Zones

Tauri delivers events by calling a callback it registered on `window`, driven
from Rust rather than from a JavaScript task zone.js has patched. A handler
written the obvious way therefore runs **outside** the Angular zone — the
signal updates correctly and nothing re-renders.

`web/src/app/core/tauri.service.ts` is the only place that deals with this.
`on()` registers the listener outside the zone and runs the handler back inside
it; `call()` re-enters the zone with the command's result rather than depending
on where the caller happened to invoke it from. Nothing else in the app touches
`invoke` or `listen` directly.

Change detection is zone-based (`provideZoneChangeDetection` with event and run
coalescing) — the waste grid fires a burst of events per tap and one pass for
the burst is enough.

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

Deletes are guarded: a series with workers on it and a reason with waste logged
against it are both refused rather than orphaning data. Deleting a *worker*
does cascade to their waste entries, so the confirmation says how many.

## Exports

Reports and Month sheet both export. The operator picks the location through
the native save dialog, Rust writes the file, and the app offers to open it in
whatever the system uses for PDFs.

The PDF renders the sheet in landscape — Sr, worker, item/series, then a
3rd/4th pair per reason and a trailing total pair, with a totals row on the
last page. It steps up from A4 to A3 automatically when there are enough
reasons to squeeze the boxes, and paginates at ~27 workers a page.

It is written by a small self-contained writer (`src-tauri/src/pdf.rs`) using
the base-14 Helvetica fonts, so nothing has to ship beside the binary. Those
fonts are Latin-only: **names typed in Gujarati render as `?` on the PDF**. The
CSV export is UTF-8 with a BOM and keeps them intact, so use CSV if the sheet
has to carry Gujarati names.

## Tech

Tauri 2 for the shell, IPC and installers. Angular 21 standalone components
with signals, on a PrimeNG 21 Aura preset in dark navy with red reserved for
danger states and grade 4; Oswald and Inter are self-hosted so the app keeps
its typography offline. Rust with rusqlite (bundled SQLite) and chrono, behind
a single guarded connection — which suits one terminal on one shop floor.
