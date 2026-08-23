//! Renders the waste dashboard as the monthly sheet it replaces.
//!
//! The PDF keeps the shape of the paper register: workers run down the page,
//! every reason owns a pair of columns headed `3rd` and `4th`, and each box
//! holds the count for that worker/reason/grade.

use crate::models::{Dashboard, GradeCounts};
use crate::pdf::{BLACK, Document, Font, Rgb, WHITE, text_width};
use crate::repo::DateRange;

const NAVY: Rgb = Rgb(0.043, 0.106, 0.200);
const NAVY_TINT: Rgb = Rgb(0.882, 0.906, 0.941);
const ZEBRA: Rgb = Rgb(0.965, 0.969, 0.976);
const RULE: Rgb = Rgb(0.30, 0.33, 0.38);
const HAIRLINE: Rgb = Rgb(0.62, 0.65, 0.70);

const A4_LANDSCAPE: (f64, f64) = (841.89, 595.28);
const A3_LANDSCAPE: (f64, f64) = (1190.55, 841.89);

const MARGIN_X: f64 = 22.0;
const MARGIN_TOP: f64 = 22.0;
const MARGIN_BOTTOM: f64 = 30.0;

const TITLE_BLOCK: f64 = 48.0;
const GROUP_ROW: f64 = 26.0;
const SUB_ROW: f64 = 13.0;
const DATA_ROW: f64 = 16.0;
const TOTAL_ROW: f64 = 19.0;

const W_SR: f64 = 26.0;
const W_NAME: f64 = 122.0;
const W_SERIES: f64 = 80.0;

/// Column geometry for one rendering, chosen so the numeric boxes stay wide
/// enough to be legible however many reasons the factory tracks.
struct Layout {
    page_w: f64,
    page_h: f64,
    /// Reason columns plus the trailing TOTAL column.
    pairs: usize,
    box_w: f64,
    rows_per_page: usize,
}

impl Layout {
    fn plan(reason_count: usize) -> Self {
        let pairs = reason_count + 1;

        // Prefer A4; step up to A3 only when A4 would squeeze the boxes.
        let (page_w, page_h) = {
            let (w, h) = A4_LANDSCAPE;
            if box_width(w, pairs) >= 21.0 { (w, h) } else { A3_LANDSCAPE }
        };

        let table_top = MARGIN_TOP + TITLE_BLOCK;
        let body_height =
            page_h - table_top - MARGIN_BOTTOM - GROUP_ROW - SUB_ROW - TOTAL_ROW;

        Layout {
            page_w,
            page_h,
            pairs,
            box_w: box_width(page_w, pairs).max(14.0),
            rows_per_page: ((body_height / DATA_ROW).floor() as usize).max(1),
        }
    }

    fn table_left(&self) -> f64 {
        MARGIN_X
    }

    fn table_top(&self) -> f64 {
        MARGIN_TOP + TITLE_BLOCK
    }

    fn grid_left(&self) -> f64 {
        MARGIN_X + W_SR + W_NAME + W_SERIES
    }

    /// Left edge of the column pair at `index` (reasons first, TOTAL last).
    fn pair_left(&self, index: usize) -> f64 {
        self.grid_left() + (index as f64) * self.box_w * 2.0
    }

    fn table_right(&self) -> f64 {
        self.pair_left(self.pairs)
    }

    fn table_width(&self) -> f64 {
        self.table_right() - self.table_left()
    }
}

fn box_width(page_w: f64, pairs: usize) -> f64 {
    let numeric_space = page_w - 2.0 * MARGIN_X - W_SR - W_NAME - W_SERIES;
    numeric_space / (pairs as f64 * 2.0)
}

/// A count of zero is left blank, the way an unused box on the paper sheet is.
fn cell_text(value: i64) -> String {
    if value == 0 { String::new() } else { value.to_string() }
}

pub struct ReportContext<'a> {
    pub dashboard: &'a Dashboard,
    pub range: &'a DateRange,
    pub series_name: Option<&'a str>,
    pub generated_at: String,
}

pub fn to_pdf(context: &ReportContext<'_>) -> Vec<u8> {
    let dashboard = context.dashboard;
    let layout = Layout::plan(dashboard.reasons.len());

    let chunks: Vec<&[crate::models::DashboardRow]> = if dashboard.rows.is_empty() {
        vec![&[]]
    } else {
        dashboard.rows.chunks(layout.rows_per_page).collect()
    };
    let page_count = chunks.len();

    let mut doc = Document::new(layout.page_w, layout.page_h, "Ceramic waste log");

    for (page_index, rows) in chunks.iter().enumerate() {
        let first_row_number = page_index * layout.rows_per_page + 1;
        let is_last = page_index + 1 == page_count;

        let canvas = doc.add_page();

        draw_title(canvas, context, &layout);
        let mut y = draw_header(canvas, dashboard, &layout);

        for (offset, row) in rows.iter().enumerate() {
            let shaded = offset % 2 == 1;
            draw_data_row(
                canvas,
                &layout,
                y,
                first_row_number + offset,
                shaded,
                &format!("{} {}", row.worker.first_name, row.worker.last_name),
                &row.worker.series_name,
                row.cells.iter().map(|cell| cell.counts),
                row.total,
                Font::Regular,
            );
            y += DATA_ROW;
        }

        if is_last {
            draw_data_row(
                canvas,
                &layout,
                y,
                0,
                false,
                "TOTAL",
                "",
                dashboard.reason_totals.iter().map(|cell| cell.counts),
                dashboard.grand_total,
                Font::Bold,
            );
            y += TOTAL_ROW;
        }

        draw_outline(canvas, &layout, y);
        draw_footer(canvas, &layout, context, page_index + 1, page_count);
    }

    doc.finish()
}

fn draw_title(canvas: &mut crate::pdf::Canvas, context: &ReportContext<'_>, layout: &Layout) {
    canvas.text(MARGIN_X, MARGIN_TOP + 14.0, 15.0, Font::Bold, NAVY, "CERAMIC WASTE LOG");

    let scope = match context.series_name {
        Some(name) => format!("Series: {name}"),
        None => "Series: All".to_string(),
    };
    canvas.text(
        MARGIN_X,
        MARGIN_TOP + 29.0,
        8.5,
        Font::Regular,
        BLACK,
        &format!("Period: {}    |    {scope}", context.range.label()),
    );

    let right = layout.table_right();
    let stamp = format!("Generated {}", context.generated_at);
    canvas.text(
        right - text_width(&stamp, Font::Regular, 8.0),
        MARGIN_TOP + 14.0,
        8.0,
        Font::Regular,
        BLACK,
        &stamp,
    );

    canvas.line(MARGIN_X, MARGIN_TOP + 36.0, right, MARGIN_TOP + 36.0, 1.2, NAVY);
}

/// Draws the two banded header rows and returns the y of the first data row.
fn draw_header(canvas: &mut crate::pdf::Canvas, dashboard: &Dashboard, layout: &Layout) -> f64 {
    let top = layout.table_top();
    let header_height = GROUP_ROW + SUB_ROW;

    canvas.rect(layout.table_left(), top, layout.table_width(), header_height, NAVY);

    // The three identity columns are one tall cell each.
    let mut x = layout.table_left();
    for (width, label) in [(W_SR, "SR"), (W_NAME, "WORKER"), (W_SERIES, "ITEM / SERIES")] {
        canvas.text_centered(
            x + width / 2.0,
            top + header_height / 2.0 + 3.0,
            width - 6.0,
            8.5,
            Font::Bold,
            WHITE,
            label,
        );
        x += width;
    }

    let labels: Vec<&str> =
        dashboard.reasons.iter().map(|reason| reason.name.as_str()).chain(["TOTAL"]).collect();

    for (index, label) in labels.iter().enumerate() {
        let left = layout.pair_left(index);
        let pair_width = layout.box_w * 2.0;

        canvas.text_centered(
            left + pair_width / 2.0,
            top + 16.0,
            pair_width - 3.0,
            7.5,
            Font::Bold,
            WHITE,
            &label.to_uppercase(),
        );

        for (grade_index, grade) in ["3rd", "4th"].iter().enumerate() {
            canvas.text_centered(
                left + layout.box_w * (grade_index as f64 + 0.5),
                top + GROUP_ROW + 9.5,
                layout.box_w - 2.0,
                6.5,
                Font::Regular,
                WHITE,
                grade,
            );
        }
    }

    // Separator between the group names and their 3rd/4th sub-headings.
    canvas.line(
        layout.grid_left(),
        top + GROUP_ROW,
        layout.table_right(),
        top + GROUP_ROW,
        0.5,
        HAIRLINE,
    );

    top + header_height
}

#[allow(clippy::too_many_arguments)]
fn draw_data_row(
    canvas: &mut crate::pdf::Canvas,
    layout: &Layout,
    y: f64,
    number: usize,
    shaded: bool,
    name: &str,
    series: &str,
    counts: impl Iterator<Item = GradeCounts>,
    total: GradeCounts,
    font: Font,
) {
    let is_total_row = number == 0;
    let height = if is_total_row { TOTAL_ROW } else { DATA_ROW };
    let baseline = y + height - 5.0;

    if is_total_row {
        canvas.rect(layout.table_left(), y, layout.table_width(), height, NAVY_TINT);
    } else if shaded {
        canvas.rect(layout.table_left(), y, layout.table_width(), height, ZEBRA);
    }

    let mut x = layout.table_left();

    if is_total_row {
        canvas.text_centered(x + W_SR / 2.0, baseline, W_SR - 4.0, 8.0, Font::Bold, NAVY, "");
        x += W_SR;
        canvas.text_clipped(x + 4.0, baseline, W_NAME - 8.0, 8.5, Font::Bold, NAVY, name);
        x += W_NAME;
    } else {
        canvas.text_centered(
            x + W_SR / 2.0,
            baseline,
            W_SR - 4.0,
            7.5,
            Font::Regular,
            BLACK,
            &format!("{number:02}"),
        );
        x += W_SR;
        canvas.text_clipped(x + 4.0, baseline, W_NAME - 8.0, 8.0, font, BLACK, name);
        x += W_NAME;
    }

    canvas.text_clipped(x + 4.0, baseline, W_SERIES - 8.0, 7.5, Font::Regular, BLACK, series);

    let ink = if is_total_row { NAVY } else { BLACK };
    for (index, count) in counts.chain(std::iter::once(total)).enumerate() {
        let left = layout.pair_left(index);
        for (grade_index, value) in [count.grade3, count.grade4].into_iter().enumerate() {
            canvas.text_centered(
                left + layout.box_w * (grade_index as f64 + 0.5),
                baseline,
                layout.box_w - 2.0,
                8.0,
                font,
                ink,
                &cell_text(value),
            );
        }
    }
}

/// Rules the grid once, after the fills are down, so no line is painted over.
fn draw_outline(canvas: &mut crate::pdf::Canvas, layout: &Layout, bottom: f64) {
    let top = layout.table_top();
    let left = layout.table_left();
    let right = layout.table_right();

    // Every horizontal rule from the first data row down.
    let header_bottom = top + GROUP_ROW + SUB_ROW;
    let mut y = header_bottom;
    while y < bottom - 0.01 {
        canvas.line(left, y, right, y, 0.4, HAIRLINE);
        y += DATA_ROW;
    }
    canvas.line(left, bottom, right, bottom, 0.9, RULE);

    // Identity columns, then a light rule per grade box and a firm one per
    // reason so the 3rd/4th pairs read as a unit.
    let mut x = left;
    for width in [W_SR, W_NAME, W_SERIES] {
        canvas.line(x, top, x, bottom, 0.9, RULE);
        x += width;
    }

    for index in 0..layout.pairs {
        let pair_left = layout.pair_left(index);
        canvas.line(pair_left, top, pair_left, bottom, 0.9, RULE);
        canvas.line(
            pair_left + layout.box_w,
            top + GROUP_ROW,
            pair_left + layout.box_w,
            bottom,
            0.4,
            HAIRLINE,
        );
    }

    canvas.line(right, top, right, bottom, 0.9, RULE);
}

fn draw_footer(
    canvas: &mut crate::pdf::Canvas,
    layout: &Layout,
    context: &ReportContext<'_>,
    page: usize,
    page_count: usize,
) {
    let y = layout.page_h - MARGIN_BOTTOM + 12.0;

    canvas.text(
        MARGIN_X,
        y,
        7.0,
        Font::Regular,
        RULE,
        "Grade 3 / Grade 4 waste, counted per worker and per reason.",
    );

    let label = format!("Page {page} of {page_count}");
    canvas.text(
        layout.table_right() - text_width(&label, Font::Regular, 7.5),
        y,
        7.5,
        Font::Regular,
        RULE,
        &label,
    );

    let _ = context;
}

pub fn to_csv(context: &ReportContext<'_>) -> String {
    let dashboard = context.dashboard;

    // A BOM so Excel opens the UTF-8 names (Gujarati included) correctly.
    let mut out = String::from("\u{feff}");

    out.push_str(&format!("Ceramic waste log,{}\n", escape_csv(&context.range.label())));
    out.push_str(&format!("Series,{}\n", escape_csv(context.series_name.unwrap_or("All"))));
    out.push_str(&format!("Generated,{}\n\n", escape_csv(&context.generated_at)));

    let mut header = String::from("Sr,Worker,Item / Series");
    for reason in &dashboard.reasons {
        header.push_str(&format!(
            ",{} 3rd,{} 4th",
            escape_csv(&reason.name),
            escape_csv(&reason.name)
        ));
    }
    header.push_str(",Total 3rd,Total 4th\n");
    out.push_str(&header);

    for (index, row) in dashboard.rows.iter().enumerate() {
        out.push_str(&format!(
            "{},{},{}",
            index + 1,
            escape_csv(&format!("{} {}", row.worker.first_name, row.worker.last_name)),
            escape_csv(&row.worker.series_name),
        ));
        for cell in &row.cells {
            out.push_str(&format!(",{},{}", cell.counts.grade3, cell.counts.grade4));
        }
        out.push_str(&format!(",{},{}\n", row.total.grade3, row.total.grade4));
    }

    out.push_str(",TOTAL,");
    for cell in &dashboard.reason_totals {
        out.push_str(&format!(",{},{}", cell.counts.grade3, cell.counts.grade4));
    }
    out.push_str(&format!(",{},{}\n", dashboard.grand_total.grade3, dashboard.grand_total.grade4));

    out
}

fn escape_csv(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        Dashboard, DashboardCell, DashboardRow, GradeCounts, RangeQuery, Reason, Worker,
    };
    use crate::repo::DateRange;

    fn reason(id: i64, name: &str) -> Reason {
        Reason {
            id,
            name: name.to_string(),
            sort_order: id,
            created_date: "2026-08-01 08:00:00".into(),
            modified_date: "2026-08-01 08:00:00".into(),
        }
    }

    fn worker(id: i64, first: &str) -> Worker {
        Worker {
            id,
            first_name: first.to_string(),
            last_name: "Patel".into(),
            phone: None,
            series_of_product_id: 1,
            series_name: "Toilet 3007".into(),
            created_date: "2026-08-01 08:00:00".into(),
            modified_date: "2026-08-01 08:00:00".into(),
        }
    }

    /// Two workers over two reasons, with totals that must reconcile.
    fn dashboard() -> Dashboard {
        let reasons = vec![reason(1, "Loader"), reason(2, "Glazing")];

        let rows = vec![
            DashboardRow {
                worker: worker(1, "Ramesh"),
                cells: vec![
                    DashboardCell { reason_id: 1, counts: GradeCounts { grade3: 2, grade4: 1 } },
                    DashboardCell { reason_id: 2, counts: GradeCounts { grade3: 0, grade4: 3 } },
                ],
                total: GradeCounts { grade3: 2, grade4: 4 },
            },
            DashboardRow {
                worker: worker(2, "Suresh"),
                cells: vec![
                    DashboardCell { reason_id: 1, counts: GradeCounts { grade3: 5, grade4: 0 } },
                    DashboardCell { reason_id: 2, counts: GradeCounts { grade3: 1, grade4: 1 } },
                ],
                total: GradeCounts { grade3: 6, grade4: 1 },
            },
        ];

        Dashboard {
            from: "2026-08-01".into(),
            to: "2026-08-31".into(),
            reasons,
            rows,
            reason_totals: vec![
                DashboardCell { reason_id: 1, counts: GradeCounts { grade3: 7, grade4: 1 } },
                DashboardCell { reason_id: 2, counts: GradeCounts { grade3: 1, grade4: 4 } },
            ],
            grand_total: GradeCounts { grade3: 8, grade4: 5 },
        }
    }

    fn range() -> DateRange {
        DateRange::resolve(&RangeQuery {
            from: Some("2026-08-01".into()),
            to: Some("2026-08-31".into()),
            series_id: None,
        })
        .expect("a valid range")
    }

    #[test]
    fn pdf_is_a_well_formed_document() {
        let range = range();
        let dashboard = dashboard();
        let bytes = to_pdf(&ReportContext {
            dashboard: &dashboard,
            range: &range,
            series_name: None,
            generated_at: "2026-08-23 12:00:00".to_string(),
        });

        assert!(bytes.starts_with(b"%PDF-1.4"), "missing the PDF header");
        assert!(bytes.ends_with(b"%%EOF\n"), "missing the trailer");

        // The cross-reference table has to name every object plus the free
        // entry, or readers reject the file.
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

    #[test]
    fn a_zero_count_leaves_the_box_blank() {
        assert_eq!(cell_text(0), "");
        assert_eq!(cell_text(7), "7");
    }

    #[test]
    fn csv_reconciles_with_the_dashboard() {
        let range = range();
        let dashboard = dashboard();
        let csv = to_csv(&ReportContext {
            dashboard: &dashboard,
            range: &range,
            series_name: Some("Toilet 3007"),
            generated_at: "2026-08-23 12:00:00".to_string(),
        });

        assert!(csv.starts_with('\u{feff}'), "Excel needs the BOM to read UTF-8");
        assert!(csv.contains("Sr,Worker,Item / Series,Loader 3rd,Loader 4th,Glazing 3rd,Glazing 4th"));
        assert!(csv.contains("1,Ramesh Patel,Toilet 3007,2,1,0,3,2,4"));
        assert!(csv.contains("2,Suresh Patel,Toilet 3007,5,0,1,1,6,1"));
        // Column totals then the grand total.
        assert!(csv.contains(",TOTAL,,7,1,1,4,8,5"));
    }

    #[test]
    fn a_wide_sheet_steps_up_to_a3() {
        // Ten reasons still fit A4; thirty would squeeze the boxes past
        // legibility, so the page grows instead.
        assert_eq!(Layout::plan(10).page_w, A4_LANDSCAPE.0);
        assert_eq!(Layout::plan(30).page_w, A3_LANDSCAPE.0);
        assert!(Layout::plan(30).box_w >= 14.0);
    }
}
