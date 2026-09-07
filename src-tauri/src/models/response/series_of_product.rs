use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesOfProduct {
    pub id: i64,
    pub name: String,
    pub created_date: String,
    pub modified_date: String,
    /// How many workers currently point at this series.
    pub worker_count: i64,
}
