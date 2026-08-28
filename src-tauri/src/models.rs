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

// ----------------------------------------------------------------- grade ---

/// A waste grade — a column pair on the paper sheet, a button on the waste
/// screen, and a barcode on the scanning sheet.
///
/// The register ships with grade 3 (salvage) and grade 4 (scrap); a factory
/// that sorts its breakages differently adds its own from the Grades screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grade {
    pub id: i64,
    pub name: String,
    pub created_date: String,
    pub modified_date: String,
    /// Waste entries recorded against this grade, so a blocked delete can say
    /// why. Not stored — counted per request, like a series' worker count.
    pub entry_count: i64,
}

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

// ------------------------------------------------------------ worker log ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerLog {
    pub id: i64,
    pub worker_id: i64,
    pub worker_name: String,
    pub reason_id: i64,
    pub reason_name: String,
    pub grade_id: i64,
    pub grade_name: String,
    pub created_date: String,
    pub modified_date: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryRequest {
    pub worker_id: i64,
    pub reason_id: i64,
    pub grade_id: i64,
}

// ------------------------------------------------------------- dashboard ---

/// One worker's count for one reason, one entry per grade.
///
/// `counts` runs parallel to [`Dashboard::grades`] rather than keying by id:
/// every consumer — the grid, the month sheet, the PDF, the CSV — walks the
/// grades in order to lay out its columns, so the aligned vector is what they
/// all want and there is no lookup to get wrong.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCell {
    pub reason_id: i64,
    pub counts: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRow {
    pub worker: Worker,
    pub cells: Vec<DashboardCell>,
    /// Row totals, one per grade.
    pub total: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub from: String,
    pub to: String,
    /// The grade columns, in the order every table renders them.
    pub grades: Vec<Grade>,
    pub reasons: Vec<Reason>,
    pub rows: Vec<DashboardRow>,
    /// Column totals, one per reason, in the same order as `reasons`.
    pub reason_totals: Vec<DashboardCell>,
    /// Sheet totals, one per grade.
    pub grand_total: Vec<i64>,
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
