//! The scanning sheet: a barcode for every grade button on the waste screen.
//!
//! One scan is one entry, so the sheet carries one barcode per worker x reason
//! x grade. That is a large number of barcodes — 24 workers and 10 reasons make
//! 480 — so it is organised the way the waste screen already is: a reason at a
//! time, workers down the page, grade 3 and grade 4 across. Everything for the
//! reason in front of the operator is on one screen, and the printed sheet gets
//! a page per reason.

use rusqlite::Connection;
use serde::Serialize;

use crate::barcode::{QUIET_ZONE, Scan, Symbol};
use crate::error::AppResult;
use crate::models::Grade;
use crate::pdf::{BLACK, Canvas, Document, Font, Rgb};
use crate::repo::{reasons, series, workers};

/// One worker's row under a reason: the two barcodes that stand in for the
/// grade 3 and grade 4 buttons.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRow {
    pub worker_id: i64,
    pub name: String,
    pub series_name: String,
    pub grade3: Symbol,
    pub grade4: Symbol,
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

    let workers = workers::list(connection, series_id)?;
    let mut sheets = Vec::new();

    for reason in reasons::list(connection)? {
        let mut rows = Vec::with_capacity(workers.len());
        for worker in &workers {
            let symbol = |grade| {
                Scan { worker_id: worker.id, reason_id: reason.id, grade }.symbol()
            };
            rows.push(WorkerRow {
                worker_id: worker.id,
                name: format!("{} {}", worker.first_name, worker.last_name).trim().to_string(),
                series_name: worker.series_name.clone(),
                grade3: symbol(Grade::Three)?,
                grade4: symbol(Grade::Four)?,
            });
        }
        sheets.push(ReasonSheet { reason_id: reason.id, reason_name: reason.name, rows });
    }

    Ok(Sheet { reasons: sheets, series_name, generated_at: crate::now() })
}

// ------------------------------------------------------------------- pdf ---

// Landscape, so a worker's name and both of their barcodes sit on one line and
// two such columns still fit across the page.
const PAGE_WIDTH: f64 = 841.89; // A4 landscape
const PAGE_HEIGHT: f64 = 595.28;
const MARGIN: f64 = 30.0;

const COLUMNS: usize = 2;
const COLUMN_GAP: f64 = 20.0;
const NAME_WIDTH: f64 = 96.0;
const CODE_GAP: f64 = 8.0;

const ROW_HEIGHT: f64 = 38.0;
const BAR_HEIGHT: f64 = 24.0;
const HEADER_HEIGHT: f64 = 52.0;

const GREY: Rgb = Rgb(0.42, 0.42, 0.42);
const RULE: Rgb = Rgb(0.78, 0.78, 0.78);

/// Renders the sheet for printing, a reason to a page.
///
/// Black on white with generous quiet zones, because this is scanned off paper
/// under shop lighting rather than admired — the screen keeps the app's dark
/// palette, the paper does not.
pub fn to_pdf(sheet: &Sheet) -> Vec<u8> {
    let mut document = Document::new(PAGE_WIDTH, PAGE_HEIGHT, "Waste log scanning sheet");

    let column_width = (PAGE_WIDTH - MARGIN * 2.0 - COLUMN_GAP * (COLUMNS as f64 - 1.0))
        / COLUMNS as f64;
    let code_width = (column_width - NAME_WIDTH - CODE_GAP) / 2.0;
    let rows_per_column = ((PAGE_HEIGHT - MARGIN - HEADER_HEIGHT - MARGIN) / ROW_HEIGHT) as usize;
    let rows_per_page = rows_per_column * COLUMNS;

    // An empty register still gets a page, so the export never produces a file
    // a reader would reject.
    if sheet.reasons.iter().all(|reason| reason.rows.is_empty()) {
        let canvas = document.add_page();
        header(canvas, sheet, "No workers", 1, 1);
        canvas.text(MARGIN, HEADER_HEIGHT + 20.0, 10.0, Font::Regular, GREY,
            "Add workers to the register, then print this sheet again.");
        return document.finish();
    }

    for reason in &sheet.reasons {
        if reason.rows.is_empty() {
            continue;
        }

        let pages = reason.rows.len().div_ceil(rows_per_page).max(1);
        for (page, chunk) in reason.rows.chunks(rows_per_page).enumerate() {
            let canvas = document.add_page();
            header(canvas, sheet, &reason.reason_name, page + 1, pages);

            for (index, row) in chunk.iter().enumerate() {
                let column = index / rows_per_column;
                let slot = index % rows_per_column;
                let x = MARGIN + column as f64 * (column_width + COLUMN_GAP);
                let y = HEADER_HEIGHT + slot as f64 * ROW_HEIGHT;

                if slot == 0 {
                    column_headings(canvas, x, code_width);
                }
                draw_row(canvas, row, x, y, column_width, code_width);
            }
        }
    }

    document.finish()
}

fn header(canvas: &mut Canvas, sheet: &Sheet, reason: &str, page: usize, pages: usize) {
    canvas.text(MARGIN, MARGIN - 6.0, 15.0, Font::Bold, BLACK, reason);

    let scope = sheet.series_name.as_deref().unwrap_or("All series");
    let mut note = format!(
        "Scan a worker's grade 3 or grade 4 barcode to record one entry.  {scope}  -  generated {}",
        sheet.generated_at
    );
    if pages > 1 {
        note.push_str(&format!("  -  page {page} of {pages}"));
    }
    canvas.text(MARGIN, MARGIN + 8.0, 7.5, Font::Regular, GREY, &note);
    canvas.line(MARGIN, MARGIN + 16.0, PAGE_WIDTH - MARGIN, MARGIN + 16.0, 0.6, RULE);
}

fn column_headings(canvas: &mut Canvas, x: f64, code_width: f64) {
    let label = |canvas: &mut Canvas, offset: f64, text: &str| {
        canvas.text_centered(
            x + NAME_WIDTH + offset + code_width / 2.0,
            HEADER_HEIGHT - 5.0,
            code_width,
            7.0,
            Font::Bold,
            GREY,
            text,
        );
    };
    canvas.text(x, HEADER_HEIGHT - 5.0, 7.0, Font::Bold, GREY, "WORKER");
    label(canvas, 0.0, "GRADE 3");
    label(canvas, code_width + CODE_GAP, "GRADE 4");
}

fn draw_row(
    canvas: &mut Canvas,
    row: &WorkerRow,
    x: f64,
    y: f64,
    column_width: f64,
    code_width: f64,
) {
    canvas.text_clipped(x, y + 12.0, NAME_WIDTH - 6.0, 9.0, Font::Bold, BLACK, &row.name);
    canvas.text_clipped(x, y + 21.0, NAME_WIDTH - 6.0, 6.5, Font::Regular, GREY, &row.series_name);

    for (offset, symbol) in
        [(0.0, &row.grade3), (code_width + CODE_GAP, &row.grade4)]
    {
        let left = x + NAME_WIDTH + offset;
        draw_symbol(canvas, symbol, left, y, code_width, BAR_HEIGHT);
        canvas.text_centered(
            left + code_width / 2.0,
            y + BAR_HEIGHT + 7.0,
            code_width,
            6.0,
            Font::Regular,
            GREY,
            &symbol.code,
        );
    }

    canvas.line(x, y + ROW_HEIGHT - 4.0, x + column_width, y + ROW_HEIGHT - 4.0, 0.25, RULE);
}

/// Draws the bars, scaled so the symbol and both quiet zones fill `width`.
fn draw_symbol(canvas: &mut Canvas, symbol: &Symbol, x: f64, y: f64, width: f64, height: f64) {
    let module = width / f64::from(symbol.module_count);
    let mut pen = x + f64::from(QUIET_ZONE) * module;

    for (index, &modules) in symbol.modules.iter().enumerate() {
        let run = f64::from(modules) * module;
        // Even indices are bars, odd are the spaces between them.
        if index % 2 == 0 {
            canvas.rect(pen, y, run, height, BLACK);
        }
        pen += run;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A register big enough to spill onto a second page for a reason, which is
    /// where a pagination bug shows up rather than on a tidy single page.
    fn sheet(workers: i64, reason_count: i64) -> Sheet {
        let reasons = (1..=reason_count)
            .map(|reason_id| ReasonSheet {
                reason_id,
                reason_name: format!("Reason {reason_id}"),
                rows: (1..=workers)
                    .map(|worker_id| WorkerRow {
                        worker_id,
                        name: format!("Worker {worker_id}"),
                        series_name: "Toilet 3007".to_string(),
                        grade3: Scan { worker_id, reason_id, grade: Grade::Three }
                            .symbol()
                            .unwrap(),
                        grade4: Scan { worker_id, reason_id, grade: Grade::Four }
                            .symbol()
                            .unwrap(),
                    })
                    .collect(),
            })
            .collect();

        Sheet {
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
        let bytes = to_pdf(&sheet(24, 10));

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

    /// A reason is a page. Twenty-four workers fit two columns of twelve, so
    /// ten reasons is ten pages — and a reason with more workers than that
    /// spills onto a second page rather than overprinting.
    #[test]
    fn each_reason_gets_its_own_page() {
        assert_eq!(page_count(&to_pdf(&sheet(24, 10))), 10);
        assert_eq!(page_count(&to_pdf(&sheet(24, 1))), 1);
        assert_eq!(page_count(&to_pdf(&sheet(25, 1))), 2);
    }

    #[test]
    fn an_empty_register_still_produces_a_readable_file() {
        let bytes = to_pdf(&sheet(0, 10));
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert_eq!(page_count(&bytes), 1);
    }

    /// Every barcode printed has to be one the scanner path accepts, and no two
    /// buttons may share a code.
    #[test]
    fn every_printed_code_parses_back_to_its_button() {
        let sheet = sheet(24, 10);
        let mut seen = std::collections::HashSet::new();

        for reason in &sheet.reasons {
            for row in &reason.rows {
                for (grade, symbol) in
                    [(Grade::Three, &row.grade3), (Grade::Four, &row.grade4)]
                {
                    let scan = Scan::parse(&symbol.code)
                        .unwrap_or_else(|_| panic!("{} did not parse back", symbol.code));
                    assert_eq!(
                        scan,
                        Scan { worker_id: row.worker_id, reason_id: reason.reason_id, grade },
                        "{} decoded to the wrong button",
                        symbol.code
                    );
                    assert!(seen.insert(symbol.code.clone()), "duplicate {}", symbol.code);
                }
            }
        }
        assert_eq!(seen.len(), 24 * 10 * 2);
    }

    /// Base-14 Helvetica is WinAnsi encoded and the width tables cover ASCII
    /// only, so a stray en-dash or bullet in the page furniture prints as `?`.
    #[test]
    fn the_sheets_own_wording_is_ascii() {
        let bytes = to_pdf(&sheet(24, 1));
        let text = String::from_utf8_lossy(&bytes);

        for phrase in ["WORKER", "GRADE 3", "GRADE 4", "Scan a worker"] {
            let line = text
                .split(&format!("({phrase}"))
                .nth(1)
                .and_then(|rest| rest.split(") Tj").next())
                .unwrap_or_else(|| panic!("{phrase} is not on the sheet"));
            assert!(!line.contains('?'), "`{phrase}{line}` lost a character to the font");
        }
    }

    #[test]
    #[ignore = "writes a file for eyeballing; run with --ignored"]
    fn write_sample_pdf() {
        let path = std::env::var("SHEET_OUT").expect("SHEET_OUT");
        std::fs::write(&path, to_pdf(&sheet(24, 3))).unwrap();
        println!("wrote {path}");
    }
}
