//! A tiny, dependency-free PDF writer.
//!
//! It emits PDF 1.4 with the two base-14 fonts we need (Helvetica and
//! Helvetica-Bold), which keeps the binary self contained: no font files have
//! to ship next to the executable and no external crate has to be trusted with
//! the layout of the waste-log sheet.
//!
//! Base-14 fonts are single byte / WinAnsi encoded, so only Latin text can be
//! drawn. Names typed in Gujarati are transliterated to `?` on the sheet; the
//! CSV export is UTF-8 and keeps them intact.

use std::fmt::Write as _;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Font {
    Regular,
    Bold,
}

impl Font {
    fn resource(self) -> &'static str {
        match self {
            Font::Regular => "F1",
            Font::Bold => "F2",
        }
    }

    fn widths(self) -> &'static [u16; 95] {
        match self {
            Font::Regular => &HELVETICA_WIDTHS,
            Font::Bold => &HELVETICA_BOLD_WIDTHS,
        }
    }
}

/// Grayscale/RGB ink, components in `0.0..=1.0`.
#[derive(Clone, Copy)]
pub struct Rgb(pub f64, pub f64, pub f64);

pub const BLACK: Rgb = Rgb(0.0, 0.0, 0.0);
pub const WHITE: Rgb = Rgb(1.0, 1.0, 1.0);

/// One page. All coordinates handed to `Canvas` are in points measured from
/// the *top left* corner, which matches how the sheet is laid out on paper;
/// the y axis is flipped on the way into the content stream.
pub struct Canvas {
    ops: String,
    pub height: f64,
}

impl Canvas {
    fn new(height: f64) -> Self {
        Canvas { ops: String::new(), height }
    }

    fn flip(&self, y: f64) -> f64 {
        self.height - y
    }

    pub fn line(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, thickness: f64, color: Rgb) {
        let _ = write!(
            self.ops,
            "{r:.3} {g:.3} {b:.3} RG {t:.2} w {x1:.2} {y1:.2} m {x2:.2} {y2:.2} l S\n",
            r = color.0,
            g = color.1,
            b = color.2,
            t = thickness,
            x1 = x1,
            y1 = self.flip(y1),
            x2 = x2,
            y2 = self.flip(y2),
        );
    }

    pub fn rect(&mut self, x: f64, y: f64, w: f64, h: f64, color: Rgb) {
        let _ = write!(
            self.ops,
            "{r:.3} {g:.3} {b:.3} rg {x:.2} {y:.2} {w:.2} {h:.2} re f\n",
            r = color.0,
            g = color.1,
            b = color.2,
            x = x,
            y = self.flip(y + h),
            w = w,
            h = h,
        );
    }

    /// Draws `text` with its baseline at `y` and its left edge at `x`.
    pub fn text(&mut self, x: f64, y: f64, size: f64, font: Font, color: Rgb, text: &str) {
        if text.is_empty() {
            return;
        }
        let _ = write!(
            self.ops,
            "BT {r:.3} {g:.3} {b:.3} rg /{f} {s:.2} Tf 1 0 0 1 {x:.2} {y:.2} Tm ({t}) Tj ET\n",
            r = color.0,
            g = color.1,
            b = color.2,
            f = font.resource(),
            s = size,
            x = x,
            y = self.flip(y),
            t = escape(text),
        );
    }

    /// Draws `text` centred on `cx`, shrinking it (down to 55% of `size`) and
    /// then clipping it so it never bleeds into the neighbouring cell.
    pub fn text_centered(
        &mut self,
        cx: f64,
        y: f64,
        max_width: f64,
        size: f64,
        font: Font,
        color: Rgb,
        text: &str,
    ) {
        let (fitted, used_size) = fit(text, font, size, max_width);
        let w = text_width(&fitted, font, used_size);
        self.text(cx - w / 2.0, y, used_size, font, color, &fitted);
    }

    /// Draws `text` left aligned at `x`, shrunk and clipped to `max_width`.
    pub fn text_clipped(
        &mut self,
        x: f64,
        y: f64,
        max_width: f64,
        size: f64,
        font: Font,
        color: Rgb,
        text: &str,
    ) {
        let (fitted, used_size) = fit(text, font, size, max_width);
        self.text(x, y, used_size, font, color, &fitted);
    }

    /// Draws `text` turned a quarter turn anticlockwise, so it reads bottom to
    /// top, with its baseline on `x` and its first letter at `y`.
    ///
    /// Same text operator as [`Canvas::text`]; only the matrix differs.
    /// `1 0 0 1` is the identity, and `0 1 -1 0` is that rotated 90°.
    pub fn text_turned(&mut self, x: f64, y: f64, size: f64, font: Font, color: Rgb, text: &str) {
        if text.is_empty() {
            return;
        }
        let _ = write!(
            self.ops,
            "BT {r:.3} {g:.3} {b:.3} rg /{f} {s:.2} Tf 0 1 -1 0 {x:.2} {y:.2} Tm ({t}) Tj ET\n",
            r = color.0,
            g = color.1,
            b = color.2,
            f = font.resource(),
            s = size,
            x = x,
            y = self.flip(y),
            t = escape(text),
        );
    }

    /// Turned text centred on `cy`, shrunk and clipped to `max_height` — the
    /// upright [`Canvas::text_centered`] with the page on its side.
    #[allow(clippy::too_many_arguments)]
    pub fn text_turned_centered(
        &mut self,
        x: f64,
        cy: f64,
        max_height: f64,
        size: f64,
        font: Font,
        color: Rgb,
        text: &str,
    ) {
        let (fitted, used_size) = fit(text, font, size, max_height);
        let h = text_width(&fitted, font, used_size);
        self.text_turned(x, cy + h / 2.0, used_size, font, color, &fitted);
    }
}

/// Width of `text` in points when set in `font` at `size`.
pub fn text_width(text: &str, font: Font, size: f64) -> f64 {
    let widths = font.widths();
    let per_mille: u32 = text
        .chars()
        .map(|c| {
            let idx = (c as u32).checked_sub(32).unwrap_or(0) as usize;
            u32::from(*widths.get(idx).unwrap_or(&556))
        })
        .sum();
    f64::from(per_mille) / 1000.0 * size
}

/// Shrinks then truncates `text` until it fits `max_width`.
fn fit(text: &str, font: Font, size: f64, max_width: f64) -> (String, f64) {
    if text_width(text, font, size) <= max_width {
        return (text.to_string(), size);
    }

    let min_size = size * 0.55;
    let mut used = size;
    while used > min_size {
        used -= 0.25;
        if text_width(text, font, used) <= max_width {
            return (text.to_string(), used);
        }
    }

    let mut clipped: String = text.to_string();
    while !clipped.is_empty() && text_width(&format!("{clipped}."), font, used) > max_width {
        clipped.pop();
    }
    if clipped.len() < text.len() && !clipped.is_empty() {
        clipped.push('.');
    }
    (clipped, used)
}

/// Escapes a string for a PDF literal and folds anything outside WinAnsi's
/// printable ASCII range down to `?`.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '(' => out.push_str("\\("),
            ')' => out.push_str("\\)"),
            ' '..='~' => out.push(c),
            _ => out.push('?'),
        }
    }
    out
}

pub struct Document {
    width: f64,
    height: f64,
    pages: Vec<Canvas>,
    title: String,
}

impl Document {
    pub fn new(width: f64, height: f64, title: impl Into<String>) -> Self {
        Document { width, height, pages: Vec::new(), title: title.into() }
    }

    pub fn add_page(&mut self) -> &mut Canvas {
        self.pages.push(Canvas::new(self.height));
        self.pages.last_mut().expect("just pushed")
    }

    /// Serialises the document. Object numbering is:
    /// 1 catalog, 2 page tree, 3 Helvetica, 4 Helvetica-Bold, then a
    /// page/contents pair per page.
    pub fn finish(&self) -> Vec<u8> {
        let page_count = self.pages.len().max(1);
        let first_page_obj = 5u32;

        let mut objects: Vec<String> = Vec::new();

        let kids: Vec<String> = (0..page_count)
            .map(|i| format!("{} 0 R", first_page_obj + (i as u32) * 2))
            .collect();

        objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());
        objects.push(format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids.join(" "),
            page_count
        ));
        objects.push(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .to_string(),
        );
        objects.push(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
                .to_string(),
        );

        let empty = Canvas::new(self.height);
        for i in 0..page_count {
            let contents_obj = first_page_obj + (i as u32) * 2 + 1;
            objects.push(format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w:.2} {h:.2}] \
                 /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {c} 0 R >>",
                w = self.width,
                h = self.height,
                c = contents_obj,
            ));
            let stream = self.pages.get(i).unwrap_or(&empty).ops.as_str();
            objects.push(format!(
                "<< /Length {len} >>\nstream\n{stream}endstream",
                len = stream.len(),
            ));
        }

        let mut out: Vec<u8> = Vec::with_capacity(8 * 1024);
        out.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

        let mut offsets: Vec<usize> = Vec::with_capacity(objects.len());
        for (i, body) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
        }

        let xref_offset = out.len();
        let size = objects.len() + 1;
        out.extend_from_slice(format!("xref\n0 {size}\n").as_bytes());
        out.extend_from_slice(b"0000000000 65535 f \n");
        for offset in &offsets {
            out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {size} /Root 1 0 R /Info << /Title ({title}) \
                 /Producer (worker-log) >> >>\nstartxref\n{xref_offset}\n%%EOF\n",
                title = escape(&self.title),
            )
            .as_bytes(),
        );

        out
    }
}

/// Helvetica advance widths for ASCII 32..=126, in 1/1000 em.
const HELVETICA_WIDTHS: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/// Helvetica-Bold advance widths for ASCII 32..=126, in 1/1000 em.
const HELVETICA_BOLD_WIDTHS: [u16; 95] = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
    611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
    278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
