use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeQuery {
    /// Inclusive start date, `YYYY-MM-DD`. Defaults to the first of this month.
    #[serde(default)]
    pub from: Option<String>,
    /// Inclusive end date, `YYYY-MM-DD`. Defaults to today.
    #[serde(default)]
    pub to: Option<String>,
    /// Optional filter to a single product series.
    #[serde(default)]
    pub series_id: Option<i64>,
}
