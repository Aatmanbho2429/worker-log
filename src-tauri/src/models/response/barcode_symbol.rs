use serde::Serialize;

/// The bars of one barcode, ready to be drawn as rectangles.
///
/// `modules` alternates bar, space, bar, space ... starting with a bar, each
/// entry a width in modules. The renderer decides what a module is worth in
/// pixels or points, which is the only thing that differs between the screen
/// and the PDF.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeSymbol {
    /// The digits encoded, shown as human-readable text under the bars.
    pub code: String,
    pub modules: Vec<u8>,
    /// Total width including both quiet zones, so callers can scale to fit.
    pub module_count: u32,
}
