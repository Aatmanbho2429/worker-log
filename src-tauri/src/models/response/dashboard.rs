use serde::Serialize;

use super::{Grade, Reason, Worker};

/// One worker's count for one reason, one entry per grade.
///
/// `counts` runs parallel to [`Dashboard::grades`] rather than keying by id:
/// every consumer — the grid, the month sheet, the PDF, the CSV — walks the
/// grades in order to lay out its columns, so the aligned vector is what they
/// all want and there is no lookup to get wrong.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCell {
    pub reason_id: i64,
    pub counts: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRow {
    pub worker: Worker,
    pub cells: Vec<DashboardCell>,
    /// Row totals, one per grade.
    pub total: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub from: String,
    pub to: String,
    /// The grade columns, in the order every table renders them.
    pub grades: Vec<Grade>,
    pub reasons: Vec<Reason>,
    pub rows: Vec<DashboardRow>,
    /// Column totals, one per reason, in the same order as `reasons`.
    pub reason_totals: Vec<DashboardCell>,
    /// Sheet totals, one per grade.
    pub grand_total: Vec<i64>,
}
