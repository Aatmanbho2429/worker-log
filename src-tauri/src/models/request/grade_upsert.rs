use serde::Deserialize;

use crate::models::trimmed;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeUpsert {
    pub name: String,
}

impl GradeUpsert {
    pub fn validated(self) -> Result<Self, String> {
        let name = trimmed(&self.name);
        if name.is_empty() {
            return Err("Grade name is required.".to_string());
        }
        Ok(GradeUpsert { name })
    }
}
