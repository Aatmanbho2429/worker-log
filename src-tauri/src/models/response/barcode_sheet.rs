use serde::Serialize;

use super::{BarcodeReasonSheet, Grade};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeSheet {
    /// The grade columns, in the order every row lays its tiles out.
    pub grades: Vec<Grade>,
    pub reasons: Vec<BarcodeReasonSheet>,
    /// The series the sheet was narrowed to, if any.
    pub series_name: Option<String>,
    pub generated_at: String,
}
