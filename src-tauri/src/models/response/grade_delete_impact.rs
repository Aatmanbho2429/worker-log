use serde::Serialize;

use super::Grade;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeDeleteImpact {
    pub grade: Grade,
    /// Printed barcodes that would stop working, so the confirm dialog can say
    /// that a fresh sheet is needed.
    pub barcodes: i64,
}
