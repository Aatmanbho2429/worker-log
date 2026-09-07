use serde::Serialize;

/// A waste grade — a column pair on the paper sheet, a button on the waste
/// screen, and a barcode on the scanning sheet.
///
/// The register ships with grade 3 (salvage) and grade 4 (scrap); a factory
/// that sorts its breakages differently adds its own from the Grades screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grade {
    pub id: i64,
    pub name: String,
    pub created_date: String,
    pub modified_date: String,
    /// Waste entries recorded against this grade, so a blocked delete can say
    /// why. Not stored — counted per request, like a series' worker count.
    pub entry_count: i64,
}
