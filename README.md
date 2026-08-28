# Ceramic Waste Log

A desktop replacement for the paper waste register kept on a sanitaryware line:
who lost a piece, where it was lost, and which grade it came off the line as.
At the end of the month it prints back out as the same sheet.

Ships as a native application — Tauri shell, Angular UI, Rust core, SQLite file.
No server to run, no browser, no network.

```
worker-log/
├── package.json   Root — `npm run dev` / `npm run build`
├── src-tauri/     Rust: Tauri commands, SQLite, PDF writer
└── web/           Angular 21 + PrimeNG front end
```

## What it does

- **Waste log** — pick the reason a piece was lost to, then tap the grade
  against the worker. Counts update instantly; a minus button beside each count
  undoes a mis-tap.
- **Month sheet** — the paper register on screen: workers down, a column per
  grade under each reason across, totals on every edge.
- **Reports** — totals for the period, a breakdown by reason, the workers with
  the most waste, the full entry history, and the PDF/CSV exports.
- **Scanning sheet** — the paper reject sheet with barcodes in the boxes:
  workers down the left, a column per grade under each reason across the top.
  One scan records one entry, and the box keeps a running count of what the
  reader has put through it. The sheet prints to PDF for the wall beside the
  line.
- **Masters** — CRUD for workers, series of product, reasons and grades.
- **Settings** — where the database file lives, and the demo data loader.

Every screen shares one date range (defaulting to the current month) and an
optional series filter.

### Grades

The register ships with **Grade 3** (salvage) and **Grade 4** (scrap) — the two
the paper sheet was ruled for — but they are rows in a `grade` table rather than
a pair of columns, so a factory that sorts its breakages differently can add its
own from the Grades screen.

A grade is one thing appearing in four places, and adding one fills all four in:
a button in every worker's row on the waste screen, a column under every reason
on the month sheet and in both exports, a barcode per worker and reason on the
scanning sheet, and a tone in the palette so it is told apart by colour and not
only by name. The first grade is the app's navy and the second the red that says
scrap, so the two that ship keep exactly the colours the floor already reads
them by.

Screens read the grade list rather than assuming two, so nothing needs a code
change to follow. What does move is how much fits on a page: an extra grade is
an extra column in every group on the printed sheet, and an extra barcode in
every row of the scanning sheet. Both give ground before they shrink anything
past legibility — see [Exports](#exports).

The barcode payload carries the grade id in a single digit, so the register
tracks at most **nine** grades; the tenth is refused with a message saying why
rather than creating a button that could never be printed.

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

The same generator is reachable from a terminal, which is easier when setting
a machine up or resetting between demos:

```bash
cargo run --manifest-path src-tauri/Cargo.toml -- seed          # empty register only
cargo run --manifest-path src-tauri/Cargo.toml -- seed --force  # clear and reseed
```

It writes to the same database the app uses, prints the path it wrote to, and
exits without opening a window. `WORKER_LOG_DB` redirects it like everywhere
else.

Loading only works on an empty register. **Replace everything with demo data**
clears the waste log, workers and series first. Reasons survive, since by then
you may have renamed them to match your own register. The generator is
deterministic, so a fresh database always seeds the same demo.

## Scanning

The waste screen's grade buttons are also barcodes. Scanning one records
exactly what tapping it records — one `worker_log` row for that worker, that
reason and that grade — so a reader can stand in for a finger without the
operator having to hold anything in their head. The buttons are unchanged;
**Scanning sheet** is the same action taken with a reader.

That means one barcode per worker x reason x grade: 24 workers, 10 reasons and
two grades is 480 of them. On screen they are laid out the way the register
they replace is — one wide grid, workers down the left and a column per grade
under each reason — so a worker's whole line is in front of the operator with
nothing to pick first. The grid is far wider than any screen, so the identity
columns and the two header rows stay pinned while the rest scrolls under them,
and the chips along the top scroll it sideways to a reason. Barcodes are never
scaled to fit; the grid gets wider instead. All of them are on the one screen — every reason, one after
another — so there is nothing to pick and nothing to navigate before scanning;
chips along the top scroll sideways to a reason without hiding any of the
others.

The printed sheet takes the same grid from the other side. The screen can scroll
sideways, so it puts workers down the left and reasons across; paper cannot, and
a page has to end somewhere, so it puts **workers across the top and reasons
down** — a reason to a band of grade rows, the way the paper register is ruled.
Everything on it is turned a quarter turn: the barcodes, the worker names, the
row labels. That is what makes the columns narrow enough to fit a whole register
across one A3. Lying flat a barcode needs about 100pt of width, and twenty-four
of them would run to two and a half pages; stood on end each needs only its bar
width and takes its length from the row instead.

Each barcode is drawn as a single SVG path rather than one rectangle per bar:
at 480 barcodes that is the difference between about 4,700 elements on the page
and some fifteen thousand, rebuilt on every change detection pass.

The grid is the only thing on that screen that scrolls — the page itself fills
the window exactly — which is what lets the scan feedback stay in view and the
header rows stay pinned. Its column widths are declared once in a `<colgroup>`
under `table-layout: fixed`, because the pinned columns are held in place by an
offset built from those same widths and a table's default auto layout is free
to render something else.

The codes themselves live in a `barcode` table — a row per button, written when
a worker, a reason or a grade is created, and backfilled on startup for a
register that predates the table. Storing them rather than deriving them on
demand means the screen, the printed PDF and the reader are all reading the same
row, and a scan resolves by looking its code up rather than by decoding it.

### The payload

Code 128, twelve digits, all numeric so the whole symbol fits subset C and
packs two digits per symbol:

```text
3 wwwww rrrr g c
| |     |    | \ check digit
| |     |    \-- grade id
| |     \------- reason id
| \------------- worker id
\--------------- format marker
```

The grade field is one digit because it used to carry the grade *number*, 3 or
4. Grades are rows now, and the two that ship are seeded with the ids 3 and 4
precisely so that a sheet printed before that change still scans. That is also
where the nine-grade ceiling comes from.

The leading `3` and the trailing check digit are what let a barcode off a
passing carton be rejected as a normal outcome rather than logged against
whoever happened to be selected — a foreign code is turned away as "not one of
ours", and a misread digit is caught by the check digit rather than resolving to
some other worker's button. Both checks live in Rust
(`src-tauri/src/barcode.rs`), not in the front end. What a code *means*, though,
is the row it was printed from rather than anything the digits are read to say,
so the screen, the printed sheet and the reader cannot disagree.

The encoder is checked against the symbology's own structural rules — every
symbol 11 modules wide, bars totalling an even number of modules, no two
patterns alike — because a transcription slip in the pattern table would still
look like a perfectly plausible barcode on screen while scanning as nothing at
all.

### Readers

A handheld scanner is a keyboard: it types the payload and presses Enter. That
is the whole integration — no driver, no SDK, no pairing. Any reader that speaks
Code 128 in keyboard-wedge (HID) mode will work, which is effectively all of
them in their factory default.

There are two ways in. The **Scanning sheet** listens to the whole page and
tells a reader from a person by speed, so the "Find a worker" box on it still
works normally. The **Waste log** and the **Month sheet** each carry a scan
field instead — an ordinary text box that keeps itself focused, because a
scanner types wherever the caret is and an operator holding a basin has no spare
hand to put it back. A scan there records exactly what a tap records, and the
grid moves under it.

The field does not wait for the Enter key. A reader that has not been given a
suffix simply stops typing at the twelfth digit, so the field records the code
once it has that many — and clears itself first, so a reader that *does* send
Enter is not counted twice.

Being an ordinary text box, it also takes a typed or pasted code. The digits are
printed under every barcode on screen and on the sheet, so **the register can be
worked and tested with no hardware at all**. Barcodes are drawn as dark bars on a white tile even
though the app is dark throughout — inverted barcodes read poorly on cheap
laser readers and not at all on some.

Reprint the sheet after adding a worker or a grade, or deleting a reason. A
code whose button is no longer on the sheet is refused with a message saying so
rather than silently doing nothing.

## How the two halves talk

There is no HTTP. The Angular side calls Rust through Tauri's IPC, and Rust
pushes events back.

**Commands** (`web/src/app/core/waste-log.service.ts` → `src-tauri/src/commands.rs`):

| Command | Purpose |
| --- | --- |
| `app_info` | version and database path |
| `list_series` `create_series` `update_series` `delete_series` | series CRUD |
| `list_reasons` `create_reason` `update_reason` `delete_reason` | reason CRUD |
| `list_grades` `create_grade` `update_grade` `delete_grade` | grade CRUD |
| `grade_delete_impact` | barcodes a delete would take off the sheet |
| `list_workers` `create_worker` `update_worker` `delete_worker` | worker CRUD |
| `worker_delete_impact` | entries a delete would remove |
| `waste_dashboard` | the worker × reason × grade grid |
| `waste_logs` | the entry history |
| `add_waste_entry` `undo_waste_entry` | record / remove one tap |
| `barcode_sheet` | every button's barcode, grouped by reason |
| `record_scan` | record the entry a scanned barcode stands for |
| `export_barcodes_pdf` | write the scanning sheet to a chosen path |
| `export_waste_pdf` `export_waste_csv` | write the sheet to a chosen path |
| `seed_demo_data` | load the demo register |

A rejected command resolves to `{ kind, message }`, where `kind` is
`badRequest`, `notFound`, `conflict` or `internal`. The front end shows the
first three as warnings the operator can act on and the last as a fault.

**Events.** Every command that writes emits `worker-log://data-changed` with
the scope that moved (`waste`, `workers`, `series`, `reasons`, `grades`,
`everything`),
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
| `grade` | id, name, created_date, modified_date |
| `worker_log` | id, worker_id, reason_id, grade_id, created_date, modified_date |
| `barcode` | id, barcode (unique), worker_id, reason_id, grade_id, created_date, modified_date |

Each tap of a grade button writes **one** `worker_log` row rather than
incrementing a counter. Counts on every screen are a `COUNT` over the selected
range, grouped by grade. That keeps a per-entry audit trail — visible under
Reports → Entry history — and makes an undo a single row delete.

`worker_log` names its grade with a `grade_id` rather than a column per grade,
so adding a grade is an `INSERT` into `grade` and needs no schema change at all.

`barcode` holds the whole worker × reason × grade grid — one row per grade
button. Missing rows are filled in whenever a worker, a reason or a grade is
created, and again on startup, so the grid is never partly covered.

`reason.sort_order` is the left-to-right order of the columns on the sheet and
the PDF; it is editable from the Reasons screen. Grades run in the order they
were added.

Deletes are guarded: a series with workers on it, and a reason or grade with
waste logged against it, are all refused rather than orphaning data — rename
instead, so past sheets stay accurate. The last remaining grade cannot go
either. Deleting a *worker* does cascade to their waste entries, so the
confirmation says how many; barcodes follow whatever they belonged to.

### Migrations

The schema is applied in numbered steps from `src-tauri/migrations`, tracked by
`PRAGMA user_version`, each in its own transaction. A register from before the
pragma was used reports version 0, which is why `0001` is written entirely in
`IF NOT EXISTS` form: re-running it over an already-initialised database has to
be a no-op.

`0002` is the one that moved grades out of `worker_log`'s columns and into their
own table. It rebuilds `worker_log` in place, mapping every `grade3` row to the
seeded Grade 3 and every `grade4` row to Grade 4 — and expanding a row that
counted more than one piece into that many entries, rather than rounding it down
and quietly losing pieces off the month's total.

## Exports

Reports, Month sheet and the Scanning sheet all export. The operator picks the location through
the native save dialog, Rust writes the file, and the app offers to open it in
whatever the system uses for PDFs.

Both PDFs give ground on layout before they shrink anything past reading.

The month sheet prefers A4 landscape and steps up to A3 once the numeric boxes
would be squeezed, which more reasons *or* more grades can both cause.

The scanning sheet is A3 landscape throughout, and never narrows a barcode past
6.35mm across its bars — the symbology's own floor for reading off paper under
shop lighting. Two things spill instead. **Reasons** run down the page and break
to a new one when the next band will not fit whole, so a reason is never split
across a fold: two grades make a 212pt band, A3 holds three, and ten reasons is
four pages. **Workers** spill only past about 38 of them, where the sheet is
printed again from the top for the ones left over; those runs are balanced
rather than filled, so sixty workers print as thirty and thirty and both pages
look alike. A register too small to fill the page gets square barcodes rather
than absurdly wide ones — past square, extra width buys no reliability.

The month sheet renders in landscape — Sr, worker, item/series, then a group of
grade boxes per reason and a trailing total group, with a totals row on the last
page and pagination at ~27 workers a page. Grade names are written the way the
paper register rules those columns, so "Grade 3" heads its box as `3rd`; the
footer spells the abbreviations back out.

It is written by a small self-contained writer (`src-tauri/src/pdf.rs`) using
the base-14 Helvetica fonts, so nothing has to ship beside the binary. Those
fonts are Latin-only: **names typed in Gujarati render as `?` on the PDF**. The
CSV export is UTF-8 with a BOM and keeps them intact, so use CSV if the sheet
has to carry Gujarati names.

## Theming

The app ships light. Every colour it paints with is a CSS custom property
declared in **`web/src/assets/styles/base/_theme.scss`**, so re-theming the
whole application means editing that one file — nothing else in the code base
names a surface, a text colour or a border directly.

```
_tokens.scss   the palette (navy, ink, red …) and the Sass aliases
_theme.scss    :root  -> the light theme that ships
               .app-dark -> the dark one
```

`_tokens.scss` aliases each Sass name to its variable — `$surface-card` *is*
`var(--surface-card)` — which is what let the theme become swappable without
every rule in the app spelling out `var(...)`. It holds no CSS rules of its own,
deliberately: every component stylesheet `@use`s it, so anything emitted there
would be stamped out again in each of them.

To switch to dark, add `class="app-dark"` to `<html>` in `web/src/index.html`.
That one class drives both the app's own tokens and PrimeNG's dark colour scheme
(`darkModeSelector` in `app.config.ts`), so the components and the page chrome
always agree. To add a third theme, copy one of the two blocks and change the
values.

Three things deliberately ignore the theme, because they are not page chrome:
the **barcode tiles**, which stay dark bars on white since inverted barcodes
read poorly on cheap laser readers and not at all on some; the **header bands**
on the sheets and tables, which keep the brand navy so a sheet reads as the
register it replaces rather than as a spreadsheet; and the **grade colours**,
which are saturated fills that carry white text either way. Grade colours do
carry a light and a dark variant for text *drawn in* the grade's colour, since a
pale tint legible on the dark theme is invisible on the light one — see
`_grades.scss`.

Since a Sass alias holds a `var()` reference rather than a colour, Sass colour
functions (`rgba()`, `darken()`, …) cannot be applied to them. Reach for a
palette variable, or one of the `--wash-*` tokens, instead.

## Tech

Tauri 2 for the shell, IPC and installers. Angular 21 standalone components
with signals, on a PrimeNG 21 Aura preset in navy with red reserved for danger
states and the scrap grade; Oswald and Inter are self-hosted so the app keeps
its typography offline. Rust with rusqlite (bundled SQLite) and chrono, behind
a single guarded connection — which suits one terminal on one shop floor.
