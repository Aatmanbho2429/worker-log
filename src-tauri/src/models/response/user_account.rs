use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAccount {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub phone: String,
    pub company_name: String,
    pub device_id: Option<String>,
    pub status: String,
    pub created_date: String,
}
