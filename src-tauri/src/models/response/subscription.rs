use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub plan: String,
    pub status: String,
    pub started_on: String,
    pub renews_on: String,
    pub days_left: i64,
    pub term_days: i64,
}
