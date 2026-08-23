pub mod logs;
pub mod reasons;
pub mod series;
pub mod workers;

use chrono::{Datelike, Local, NaiveDate};

use crate::error::{AppError, AppResult};
use crate::models::RangeQuery;

/// An inclusive `YYYY-MM-DD` range plus the half-open timestamp bounds used
/// against `created_date`, which is stored as local `YYYY-MM-DD HH:MM:SS`.
#[derive(Debug, Clone)]
pub struct DateRange {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub series_id: Option<i64>,
}

impl DateRange {
    /// Defaults to the current calendar month, which is the period the sheet
    /// is filed for.
    pub fn resolve(query: &RangeQuery) -> AppResult<Self> {
        let today = Local::now().date_naive();
        let month_start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
            .expect("first of the current month is a valid date");

        let from = parse_date(query.from.as_deref(), month_start, "from")?;
        let to = parse_date(query.to.as_deref(), today, "to")?;

        if to < from {
            return Err(AppError::BadRequest(
                "The end of the range cannot be before its start.".to_string(),
            ));
        }

        Ok(DateRange { from, to, series_id: query.series_id.filter(|id| *id > 0) })
    }

    pub fn start_bound(&self) -> String {
        format!("{} 00:00:00", self.from)
    }

    /// Exclusive upper bound: midnight at the start of the day after `to`.
    pub fn end_bound(&self) -> String {
        let next = self.to.succ_opt().unwrap_or(self.to);
        format!("{next} 00:00:00")
    }

    pub fn label(&self) -> String {
        format!("{} to {}", self.from.format("%d %b %Y"), self.to.format("%d %b %Y"))
    }
}

fn parse_date(raw: Option<&str>, fallback: NaiveDate, field: &str) -> AppResult<NaiveDate> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(fallback);
    };

    // Accept a bare date as well as the full ISO instant a browser's
    // `toISOString()` produces.
    let date_part = raw.split(['T', ' ']).next().unwrap_or(raw);

    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").map_err(|_| {
        AppError::BadRequest(format!("`{field}` must be a date in YYYY-MM-DD form, got `{raw}`."))
    })
}
