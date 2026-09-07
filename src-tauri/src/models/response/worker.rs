use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worker {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub phone: Option<String>,
    pub series_of_product_id: i64,
    /// Denormalised for the list screens so they need a single request.
    pub series_name: String,
    pub created_date: String,
    pub modified_date: String,
}
