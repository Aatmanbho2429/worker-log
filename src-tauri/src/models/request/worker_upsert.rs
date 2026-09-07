use serde::Deserialize;

use crate::models::trimmed;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerUpsert {
    pub first_name: String,
    pub last_name: String,
    #[serde(default)]
    pub phone: Option<String>,
    pub series_of_product_id: i64,
}

impl WorkerUpsert {
    pub fn validated(self) -> Result<Self, String> {
        let first_name = trimmed(&self.first_name);
        let last_name = trimmed(&self.last_name);

        if first_name.is_empty() {
            return Err("First name is required.".to_string());
        }
        if last_name.is_empty() {
            return Err("Last name is required.".to_string());
        }
        if self.series_of_product_id <= 0 {
            return Err("Series of product is required.".to_string());
        }

        let phone = self
            .phone
            .as_deref()
            .map(trimmed)
            .filter(|p| !p.is_empty());

        if let Some(phone) = &phone {
            if phone.len() > 20 || !phone.chars().all(|c| c.is_ascii_digit() || "+- ()".contains(c))
            {
                return Err("Phone number may only contain digits, spaces and + - ( ).".to_string());
            }
        }

        Ok(WorkerUpsert {
            first_name,
            last_name,
            phone,
            series_of_product_id: self.series_of_product_id,
        })
    }
}
