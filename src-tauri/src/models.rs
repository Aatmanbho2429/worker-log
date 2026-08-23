use serde::{Deserialize, Serialize};

fn trimmed(value: &str) -> String {
    value.trim().to_string()
}

// ---------------------------------------------------------------- series ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesOfProduct {
    pub id: i64,
    pub name: String,
    pub created_date: String,
    pub modified_date: String,
    /// How many workers currently point at this series.
    pub worker_count: i64,
}

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

// ---------------------------------------------------------------- reason ---

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

// ---------------------------------------------------------------- worker ---

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

// ------------------------------------------------------------ worker log ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerLog {
    pub id: i64,
    pub worker_id: i64,
    pub worker_name: String,
    pub grade3: i64,
    pub grade4: i64,
    pub reason_id: i64,
    pub reason_name: String,
    pub created_date: String,
    pub modified_date: String,
}

/// A grade is either 3 or 4 — the two waste grades tracked on the sheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "i64", into = "i64")]
pub enum Grade {
    Three,
    Four,
}

impl TryFrom<i64> for Grade {
    type Error = String;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            3 => Ok(Grade::Three),
            4 => Ok(Grade::Four),
            other => Err(format!("Grade must be 3 or 4, got {other}.")),
        }
    }
}

impl From<Grade> for i64 {
    fn from(grade: Grade) -> i64 {
        match grade {
            Grade::Three => 3,
            Grade::Four => 4,
        }
    }
}

impl Grade {
    /// The `(grade3, grade4)` pair a single tap writes into `worker_log`.
    pub fn counters(self) -> (i64, i64) {
        match self {
            Grade::Three => (1, 0),
            Grade::Four => (0, 1),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryRequest {
    pub worker_id: i64,
    pub reason_id: i64,
    pub grade: Grade,
}

// ------------------------------------------------------------- dashboard ---

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeCounts {
    pub grade3: i64,
    pub grade4: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCell {
    pub reason_id: i64,
    #[serde(flatten)]
    pub counts: GradeCounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRow {
    pub worker: Worker,
    pub cells: Vec<DashboardCell>,
    pub total: GradeCounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub from: String,
    pub to: String,
    pub reasons: Vec<Reason>,
    pub rows: Vec<DashboardRow>,
    /// Column totals, one per reason, in the same order as `reasons`.
    pub reason_totals: Vec<DashboardCell>,
    pub grand_total: GradeCounts,
}

// ----------------------------------------------------------------- query ---

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
