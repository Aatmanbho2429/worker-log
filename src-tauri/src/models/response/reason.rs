use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reason {
    pub id: i64,
    pub name: String,
    /// Left-to-right position of the reason's column pair on the sheet.
    pub sort_order: i64,
    pub created_date: String,
    pub modified_date: String,
}
