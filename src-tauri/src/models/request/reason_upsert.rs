use serde::Deserialize;

use crate::models::trimmed;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonUpsert {
    pub name: String,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

impl ReasonUpsert {
    pub fn validated(self) -> Result<Self, String> {
        let name = trimmed(&self.name);
        if name.is_empty() {
            return Err("Reason name is required.".to_string());
        }
        Ok(ReasonUpsert { name, sort_order: self.sort_order })
    }
}
