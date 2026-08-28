//! The scanning sheet: a barcode for every grade button on the waste screen.
//!
//! One scan is one entry, so the sheet carries one barcode per worker x reason
//! x grade — 24 workers, 10 reasons and two grades make 480. Both the screen
//! and the paper take the shape of the register they replace, and reach it from
//! opposite directions: the screen puts workers down the left and reasons
//! across, because it can scroll sideways; the paper puts workers across and
//! reasons down, because it cannot, and a page has to end somewhere.
//!
//! The codes come out of the `barcode` table rather than being derived here,
//! so what is printed is the same row a scan resolves against.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::Serialize;

use crate::barcode::{QUIET_ZONE, Symbol, encode};
use crate::error::AppResult;
use crate::models::Grade;
use crate::pdf::{BLACK, Canvas, Document, Font, Rgb, WHITE};
use crate::repo::{barcodes, grades, reasons, series, workers};

/// One grade's barcode in a worker's row: the button it stands in for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeTile {
    pub grade_id: i64,
    pub grade_name: String,
    pub symbol: Symbol,
}

/// One worker's row under a reason, a tile per grade.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRow {
    pub worker_id: i64,
    pub name: String,
    pub series_name: String,
    pub tiles: Vec<GradeTile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonSheet {
    pub reason_id: i64,
    pub reason_name: String,
    pub rows: Vec<WorkerRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    /// The grade columns, in the order every row lays its tiles out.
    pub grades: Vec<Grade>,
    pub reasons: Vec<ReasonSheet>,
    /// The series the sheet was narrowed to, if any.
    pub series_name: Option<String>,
    pub generated_at: String,
}

pub fn build(connection: &Connection, series_id: Option<i64>) -> AppResult<Sheet> {
    let series_name = match series_id {
        Some(id) => Some(series::get(connection, id)?.name),
        None => None,
    };

    let grades = grades::list(connection)?;
    let workers = workers::list(connection, series_id)?;
    let mut sheets = Vec::new();

    for reason in reasons::list(connection)? {
        // One query per reason rather than one per button: a full register is
        // hundreds of barcodes, and the sheet is rebuilt whenever a worker or
        // a reason moves.
        let codes: HashMap<(i64, i64), String> = barcodes::for_reason(connection, reason.id)?
            .into_iter()
            .map(|button| ((button.worker_id, button.grade_id), button.barcode))
            .collect();

        let mut rows = Vec::with_capacity(workers.len());
        for worker in &workers {
            // A button with no barcode row is a button that cannot be scanned,
            // so it is left off the sheet rather than printed as a blank.
            let tiles = grades
                .iter()
                .filter_map(|grade| {
                    codes.get(&(worker.id, grade.id)).map(|code| GradeTile {
                        grade_id: grade.id,
                        grade_name: grade.name.clone(),
                        symbol: encode(code),
                    })
                })
                .collect::<Vec<_>>();

            rows.push(WorkerRow {
                worker_id: worker.id,
                name: format!("{} {}", worker.first_name, worker.last_name).trim().to_string(),
                series_name: worker.series_name.clone(),
                tiles,
            });
        }
        sheets.push(ReasonSheet { reason_id: reason.id, reason_name: reason.name, rows });
    }

    Ok(Sheet { grades, reasons: sheets, series_name, generated_at: crate::now() })
}

// ------------------------------------------------------------------- pdf ---
//
// The printed sheet is the paper register's grid with a barcode in every box:
// a worker to a column, a reason to a band of grade rows, and the whole of a
// worker's line reachable without turning a page.
//
// Everything on it is turned a quarter turn — the barcodes, the worker names,
// the row labels. That is what makes the columns narrow enough to fit a full
// register across one sheet: lying flat a barcode needs about 100pt of width
// and twenty-four of them would run to two and a half A3 pages, but stood on
// end each needs only its bar width and takes its length from the row instead.

const PAGE_WIDTH: f64 = 1190.55; // A3 landscape
const PAGE_HEIGHT: f64 = 841.89;
const MARGIN: f64 = 30.0;

/// The label block down the left: the reason's name, spanning its grade rows,
/// and the grade's name beside it against each row.
const LABEL_REASON: f64 = 22.0;
const LABEL_GRADE: f64 = 18.0;
const LABEL: f64 = LABEL_REASON + LABEL_GRADE;

const TITLE_BLOCK: f64 = 28.0;
/// The band of turned worker names across the top.
const HEADER: f64 = 92.0;

/// The turned digits printed beside each barcode, and the gap around them.
const CODE_TEXT: f64 = 7.0;
const GUTTER: f64 = 3.0;

const BAR_LENGTH: f64 = 96.0;
const ROW_PAD: f64 = 10.0;
const ROW: f64 = BAR_LENGTH + ROW_PAD;

/// The narrowest a barcode may be printed across its bars and still read off
/// paper under shop lighting — 6.35mm, the symbology's own floor. Columns are
/// never squeezed past it; the register spills onto more pages instead.
const MIN_BAR_WIDTH: f64 = 18.0;
const MIN_COLUMN: f64 = MIN_BAR_WIDTH + CODE_TEXT + GUTTER;

/// A barcode is never printed wider across its bars than it is long, however
/// much spare paper there is. A three-worker register would otherwise get
/// barcodes a foot wide, which reads as a mistake rather than as generosity;
/// past square, the extra width buys no scanning reliability at all.
const MAX_COLUMN: f64 = BAR_LENGTH + CODE_TEXT + GUTTER;

const GREY: Rgb = Rgb(0.42, 0.42, 0.42);
const RULE: Rgb = Rgb(0.78, 0.78, 0.78);
const HAIRLINE: Rgb = Rgb(0.83, 0.85, 0.89);
const FIRM: Rgb = Rgb(0.53, 0.58, 0.65);
const BAND: Rgb = Rgb(0.055, 0.141, 0.251);
const BAND_MUTED: Rgb = Rgb(0.62, 0.70, 0.79);
const BAND_RULE: Rgb = Rgb(0.23, 0.32, 0.45);
const ZEBRA: Rgb = Rgb(0.961, 0.969, 0.980);

/// How the register divides between pages.
///
/// Two things spill. Reasons run down the page and break to a new one when the
/// next band will not fit whole — a reason is never split across a fold. And a
/// register with more workers than fit across the sheet is printed again from
/// the top for the workers left over, so a column is never narrowed past
/// [`MIN_BAR_WIDTH`] to make everyone fit.
struct Layout {
    column_width: f64,
    bar_width: f64,
    workers_per_page: usize,
    bands_per_page: usize,
    band_height: f64,
}

impl Layout {
    fn plan(worker_count: usize, grade_count: usize) -> Self {
        let workers = worker_count.max(1);
        let grades = grade_count.max(1);

        let available = PAGE_WIDTH - MARGIN * 2.0 - LABEL;
        let most = ((available / MIN_COLUMN) as usize).max(1);

        // Runs are balanced rather than filled: 60 workers over two pages is
        // 30 and 30, not 38 and 22. Every page then carries the same columns at
        // the same width, so a sheet looks the same wherever it was cut.
        let runs = workers.div_ceil(most);
        let workers_per_page = workers.div_ceil(runs);

        let column_width = (available / workers_per_page as f64).min(MAX_COLUMN);

        let band_height = grades as f64 * ROW;
        let body_height = PAGE_HEIGHT - MARGIN * 2.0 - TITLE_BLOCK - HEADER;

        Layout {
            column_width,
            bar_width: column_width - CODE_TEXT - GUTTER,
            workers_per_page,
            bands_per_page: ((body_height / band_height) as usize).max(1),
            band_height,
        }
    }

    /// How wide the sheet actually is on this page — the label block plus the
    /// columns in front of it. Capped columns can leave the page wider than the
    /// sheet, and the rules and header band stop where the grid does.
    fn sheet_width(&self, columns: usize) -> f64 {
        LABEL + columns as f64 * self.column_width
    }

    fn grid_left(&self) -> f64 {
        MARGIN + LABEL
    }

    fn header_top(&self) -> f64 {
        MARGIN + TITLE_BLOCK
    }

    fn body_top(&self) -> f64 {
        self.header_top() + HEADER
    }

    /// Left edge of the worker at `index` within the page's own run.
    fn column_left(&self, index: usize) -> f64 {
        self.grid_left() + index as f64 * self.column_width
    }
}

/// One worker's column: the same person in every band on the page.
struct Column<'a> {
    worker_id: i64,
    name: &'a str,
    series_name: &'a str,
}

/// Renders the sheet for printing.
///
/// Black on white with generous quiet zones, because this is scanned off paper
/// under shop lighting rather than admired — the screen keeps the app's own
/// palette, the paper does not.
pub fn to_pdf(sheet: &Sheet) -> Vec<u8> {
    let mut document = Document::new(PAGE_WIDTH, PAGE_HEIGHT, "Waste log scanning sheet");

    // Every reason lists every worker, so the first one fixes the running order
    // and the rest are looked up against it.
    let columns: Vec<Column<'_>> = sheet
        .reasons
        .first()
        .map(|reason| {
            reason
                .rows
                .iter()
                .map(|row| Column {
                    worker_id: row.worker_id,
                    name: row.name.as_str(),
                    series_name: row.series_name.as_str(),
                })
                .collect()
        })
        .unwrap_or_default();

    // An empty register still gets a page, so the export never produces a file
    // a reader would reject.
    if columns.is_empty() || sheet.grades.is_empty() {
        let layout = Layout::plan(1, sheet.grades.len());
        let canvas = document.add_page();
        title_block(canvas, sheet, 1, 1);
        canvas.text(MARGIN, layout.body_top(), 10.0, Font::Regular, GREY,
            "Add workers to the register, then print this sheet again.");
        return document.finish();
    }

    let layout = Layout::plan(columns.len(), sheet.grades.len());
    let barcodes = index_by_button(sheet);

    let worker_runs = columns.chunks(layout.workers_per_page).count();
    let reason_runs = sheet.reasons.chunks(layout.bands_per_page).count();
    let pages = worker_runs * reason_runs;
    let mut page = 0;

    for run in columns.chunks(layout.workers_per_page) {
        for bands in sheet.reasons.chunks(layout.bands_per_page) {
            page += 1;
            let canvas = document.add_page();

            title_block(canvas, sheet, page, pages);
            worker_header(canvas, &layout, run);

            for (index, reason) in bands.iter().enumerate() {
                draw_band(canvas, &layout, sheet, reason, run, &barcodes, index);
            }

            grid_rules(canvas, &layout, run.len(), bands.len());
        }
    }

    document.finish()
}

/// `(reason_id, worker_id, grade_id)` to the symbol printed in that box.
type ButtonIndex<'a> = HashMap<(i64, i64, i64), &'a Symbol>;

fn index_by_button(sheet: &Sheet) -> ButtonIndex<'_> {
    let mut index = HashMap::new();
    for reason in &sheet.reasons {
        for row in &reason.rows {
            for tile in &row.tiles {
                index.insert((reason.reason_id, row.worker_id, tile.grade_id), &tile.symbol);
            }
        }
    }
    index
}

fn title_block(canvas: &mut Canvas, sheet: &Sheet, page: usize, pages: usize) {
    canvas.text(MARGIN, MARGIN + 13.0, 15.0, Font::Bold, BLACK, "REJECT / SCRAP REPORT");

    let scope = sheet.series_name.as_deref().unwrap_or("All series");
    let mut note = format!(
        "Scan the box where a worker's column meets the reason and grade.  \
         {scope}  -  generated {}",
        sheet.generated_at
    );
    if pages > 1 {
        note.push_str(&format!("  -  page {page} of {pages}"));
    }
    canvas.text(MARGIN, MARGIN + 24.0, 7.5, Font::Regular, GREY, &note);
}

/// The names across the top, turned so a full name fits a column that is only
/// as wide as a barcode.
fn worker_header(canvas: &mut Canvas, layout: &Layout, run: &[Column<'_>]) {
    let top = layout.header_top();
    canvas.rect(MARGIN, top, layout.sheet_width(run.len()), HEADER, BAND);

    canvas.text_turned_centered(
        MARGIN + LABEL / 2.0 + 2.5,
        top + HEADER / 2.0,
        HEADER - 8.0,
        7.0,
        Font::Bold,
        WHITE,
        "REASON / GRADE",
    );

    for (index, column) in run.iter().enumerate() {
        let x = layout.column_left(index);
        canvas.text_turned_centered(
            x + layout.column_width * 0.40,
            top + HEADER / 2.0,
            HEADER - 8.0,
            7.6,
            Font::Bold,
            WHITE,
            column.name,
        );
        canvas.text_turned_centered(
            x + layout.column_width * 0.74,
            top + HEADER / 2.0,
            HEADER - 8.0,
            5.8,
            Font::Regular,
            BAND_MUTED,
            column.series_name,
        );
        if index > 0 {
            canvas.rect(x, top, 0.5, HEADER, BAND_RULE);
        }
    }
}

/// One reason: its name spanning a row per grade, and a barcode in every box.
fn draw_band(
    canvas: &mut Canvas,
    layout: &Layout,
    sheet: &Sheet,
    reason: &ReasonSheet,
    run: &[Column<'_>],
    barcodes: &ButtonIndex<'_>,
    index: usize,
) {
    let top = layout.body_top() + index as f64 * layout.band_height;

    let width = layout.sheet_width(run.len());

    if index % 2 == 1 {
        canvas.rect(MARGIN, top, width, layout.band_height, ZEBRA);
    }

    canvas.text_turned_centered(
        MARGIN + LABEL_REASON / 2.0 + 3.5,
        top + layout.band_height / 2.0,
        layout.band_height - 8.0,
        10.0,
        Font::Bold,
        BLACK,
        &reason.reason_name.to_uppercase(),
    );

    for (slot, grade) in sheet.grades.iter().enumerate() {
        let y = top + slot as f64 * ROW;

        canvas.text_turned_centered(
            MARGIN + LABEL_REASON + LABEL_GRADE / 2.0 + 2.5,
            y + ROW / 2.0,
            ROW - 8.0,
            7.4,
            Font::Bold,
            BLACK,
            &grade.name.to_uppercase(),
        );

        for (index, column) in run.iter().enumerate() {
            // A button with no barcode row cannot be scanned, so its box is
            // left empty rather than filled with bars that resolve to nothing.
            let Some(symbol) = barcodes.get(&(reason.reason_id, column.worker_id, grade.id))
            else {
                continue;
            };

            let x = layout.column_left(index);
            draw_symbol(canvas, symbol, x + 1.5, y + 4.0, layout.bar_width, BAR_LENGTH);
            canvas.text_turned_centered(
                x + 1.5 + layout.bar_width + CODE_TEXT - 1.5,
                y + 4.0 + BAR_LENGTH / 2.0,
                BAR_LENGTH,
                5.0,
                Font::Regular,
                GREY,
                &symbol.code,
            );
        }

        // A hairline between a reason's grades, a firm rule under the reason.
        let last = slot + 1 == sheet.grades.len();
        let thickness = if last { 0.8 } else { 0.4 };
        canvas.rect(
            MARGIN,
            y + ROW - thickness,
            width,
            thickness,
            if last { FIRM } else { RULE },
        );
    }
}

fn grid_rules(canvas: &mut Canvas, layout: &Layout, columns: usize, bands: usize) {
    let top = layout.header_top();
    let bottom = layout.body_top() + bands as f64 * layout.band_height;
    let width = layout.sheet_width(columns);

    for index in 0..=columns {
        canvas.rect(layout.column_left(index), top, 0.4, bottom - top, HAIRLINE);
    }
    for x in [MARGIN, MARGIN + LABEL_REASON, layout.grid_left(), MARGIN + width - 0.8] {
        canvas.rect(x, top, 0.8, bottom - top, FIRM);
    }
    canvas.rect(MARGIN, top, width, 0.8, FIRM);
}

/// Draws one barcode standing on end: every module becomes a stripe across the
/// column, and the symbol's length runs down the row.
fn draw_symbol(canvas: &mut Canvas, symbol: &Symbol, x: f64, y: f64, width: f64, length: f64) {
    let module = length / f64::from(symbol.module_count);
    let mut pen = y + f64::from(QUIET_ZONE) * module;

    for (index, &modules) in symbol.modules.iter().enumerate() {
        let run = f64::from(modules) * module;
        // Even indices are bars, odd are the spaces between them.
        if index % 2 == 0 {
            canvas.rect(x, pen, width, run, BLACK);
        }
        pen += run;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::barcode::Scan;

    fn grade(id: i64, name: &str) -> Grade {
        Grade {
            id,
            name: name.to_string(),
            created_date: "2026-08-01 08:00:00".into(),
            modified_date: "2026-08-01 08:00:00".into(),
            entry_count: 0,
        }
    }

    /// A register big enough to spill onto a second page for a reason, which is
    /// where a pagination bug shows up rather than on a tidy single page.
    fn sheet(workers: i64, reason_count: i64, grade_ids: &[i64]) -> Sheet {
        let grades: Vec<Grade> =
            grade_ids.iter().map(|id| grade(*id, &format!("Grade {id}"))).collect();

        let reasons = (1..=reason_count)
            .map(|reason_id| ReasonSheet {
                reason_id,
                reason_name: format!("Reason {reason_id}"),
                rows: (1..=workers)
                    .map(|worker_id| WorkerRow {
                        worker_id,
                        name: format!("Worker {worker_id}"),
                        series_name: "Toilet 3007".to_string(),
                        tiles: grades
                            .iter()
                            .map(|grade| GradeTile {
                                grade_id: grade.id,
                                grade_name: grade.name.clone(),
                                symbol: encode(
                                    &Scan { worker_id, reason_id, grade_id: grade.id }
                                        .payload()
                                        .unwrap(),
                                ),
                            })
                            .collect(),
                    })
                    .collect(),
            })
            .collect();

        Sheet {
            grades,
            reasons,
            series_name: None,
            generated_at: "2026-08-23 12:00:00".to_string(),
        }
    }

    fn page_count(bytes: &[u8]) -> usize {
        let text = String::from_utf8_lossy(bytes);
        text.split("/Type /Pages /Kids")
            .nth(1)
            .and_then(|rest| rest.split("/Count ").nth(1))
            .and_then(|rest| rest.split(' ').next())
            .and_then(|count| count.trim().parse().ok())
            .expect("a page count")
    }

    #[test]
    fn pdf_is_a_well_formed_document() {
        let bytes = to_pdf(&sheet(24, 10, &[3, 4]));

        assert!(bytes.starts_with(b"%PDF-1.4"), "missing the PDF header");
        assert!(bytes.ends_with(b"%%EOF\n"), "missing the trailer");

        let text = String::from_utf8_lossy(&bytes);
        let declared: usize = text
            .split("xref\n0 ")
            .nth(1)
            .and_then(|rest| rest.split('\n').next())
            .and_then(|count| count.trim().parse().ok())
            .expect("an xref count");
        let objects = text.matches(" 0 obj\n").count();
        assert_eq!(declared, objects + 1, "xref size must be objects + the free entry");
    }

    /// Reasons run down the page and break to a new one when the next band
    /// will not fit whole. Two grades make a 212pt band and A3 holds three of
    /// them, so ten reasons is four pages however many workers are on it.
    #[test]
    fn reasons_run_down_and_break_between_pages() {
        assert_eq!(page_count(&to_pdf(&sheet(24, 10, &[3, 4]))), 4);
        assert_eq!(page_count(&to_pdf(&sheet(24, 3, &[3, 4]))), 1);
        assert_eq!(page_count(&to_pdf(&sheet(24, 4, &[3, 4]))), 2);
        assert_eq!(page_count(&to_pdf(&sheet(3, 10, &[3, 4]))), 4, "same for a small register");
    }

    /// A third grade makes the band half again as tall, so fewer fit a page.
    #[test]
    fn more_grades_make_taller_bands() {
        let two = Layout::plan(24, 2);
        let three = Layout::plan(24, 3);

        assert_eq!(two.bands_per_page, 3);
        assert_eq!(three.bands_per_page, 2);
        assert!(three.band_height > two.band_height);

        assert_eq!(page_count(&to_pdf(&sheet(24, 10, &[3, 4, 5]))), 5);
    }

    /// The bars never go under what a reader picks up off paper. A register
    /// with more workers than fit across is printed again for the rest rather
    /// than squeezed.
    #[test]
    fn bars_stay_scannable_however_many_workers_there_are() {
        for workers in [1, 3, 24, 38, 39, 80] {
            let layout = Layout::plan(workers, 2);
            assert!(
                layout.bar_width >= MIN_BAR_WIDTH,
                "{workers} workers printed {}pt bars",
                layout.bar_width
            );
            assert!(
                layout.workers_per_page >= 1 && layout.workers_per_page <= workers,
                "{workers} workers got a nonsensical run of {}",
                layout.workers_per_page
            );
        }

        // Comfortably inside one page, so nobody is split off.
        assert_eq!(Layout::plan(24, 2).workers_per_page, 24);

        // Past the point where they fit, the sheet repeats for the remainder:
        // ten reasons is four pages, and eighty workers take three runs of them.
        let wide = Layout::plan(80, 2);
        assert!(wide.workers_per_page < 80);
        assert_eq!(page_count(&to_pdf(&sheet(80, 10, &[3, 4]))), 4 * 3);
    }

    #[test]
    fn an_empty_register_still_produces_a_readable_file() {
        for empty in [sheet(0, 10, &[3, 4]), sheet(24, 0, &[3, 4]), sheet(24, 10, &[])] {
            let bytes = to_pdf(&empty);
            assert!(bytes.starts_with(b"%PDF-1.4"));
            assert_eq!(page_count(&bytes), 1);
        }
    }

    /// Every barcode printed has to be one the scanner path accepts, and no two
    /// buttons may share a code.
    #[test]
    fn every_printed_code_parses_back_to_its_button() {
        let sheet = sheet(24, 10, &[3, 4]);
        let mut seen = std::collections::HashSet::new();

        for reason in &sheet.reasons {
            for row in &reason.rows {
                for tile in &row.tiles {
                    let scan = Scan::parse(&tile.symbol.code)
                        .unwrap_or_else(|_| panic!("{} did not parse back", tile.symbol.code));
                    assert_eq!(
                        scan,
                        Scan {
                            worker_id: row.worker_id,
                            reason_id: reason.reason_id,
                            grade_id: tile.grade_id,
                        },
                        "{} decoded to the wrong button",
                        tile.symbol.code
                    );
                    assert!(seen.insert(tile.symbol.code.clone()), "duplicate {}", tile.symbol.code);
                }
            }
        }
        assert_eq!(seen.len(), 24 * 10 * 2);
    }

    /// Base-14 Helvetica is WinAnsi encoded and the width tables cover ASCII
    /// only, so a stray en-dash or bullet in the page furniture prints as `?`.
    #[test]
    fn the_sheets_own_wording_is_ascii() {
        let bytes = to_pdf(&sheet(24, 1, &[3, 4]));
        let text = String::from_utf8_lossy(&bytes);

        for phrase in ["REJECT / SCRAP REPORT", "GRADE 3", "GRADE 4", "REASON / GRADE", "Scan the box"] {
            let line = text
                .split(&format!("({phrase}"))
                .nth(1)
                .and_then(|rest| rest.split(") Tj").next())
                .unwrap_or_else(|| panic!("{phrase} is not on the sheet"));
            assert!(!line.contains('?'), "`{phrase}{line}` lost a character to the font");
        }
    }

    /// Writes one file per grade count into `SHEET_OUT`, so the two-grade
    /// sheet, the one-column fallback and the wrapped block can be compared
    /// side by side rather than described to each other.
    #[test]
    #[ignore = "writes files for eyeballing; run with --ignored"]
    fn write_sample_pdfs() {
        let directory = std::env::var("SHEET_OUT").expect("SHEET_OUT");

        for (name, workers, reasons, grades) in [
            ("full", 24, 10, &[3, 4][..]),
            ("small", 3, 10, &[3, 4][..]),
            ("three-grades", 24, 10, &[3, 4, 5][..]),
            ("overflowing", 60, 4, &[3, 4][..]),
        ] {
            let path = format!("{directory}/scanning-sheet-{name}.pdf");
            std::fs::write(&path, to_pdf(&sheet(workers, reasons, grades))).unwrap();
            println!("wrote {path}");
        }
    }
}
