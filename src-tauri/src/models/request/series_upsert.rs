use serde::Deserialize;

use crate::models::trimmed;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesUpsert {
    pub name: String,
}

impl SeriesUpsert {
    pub fn validated(self) -> Result<Self, String> {
        let name = trimmed(&self.name);
        if name.is_empty() {
            return Err("Series name is required.".to_string());
        }
        Ok(SeriesUpsert { name })
    }
}
