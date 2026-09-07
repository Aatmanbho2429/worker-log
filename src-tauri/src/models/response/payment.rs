use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: i64,
    pub reference: String,
    pub paid_on: String,
    pub plan: String,
    pub period_from: String,
    pub period_to: String,
    pub amount: f64,
    pub currency: String,
    pub method: String,
    pub status: String,
}
