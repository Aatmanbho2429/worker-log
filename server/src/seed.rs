//! Demo data for trying the app out.
//!
//! Entries are written straight into `worker_log` with back-dated timestamps
//! rather than through the API, because the point is to fill the *previous*
//! month as well as this one — that is what gives the date filters, the "Last
//! month" preset and the PDF export something to show.
//!
//! Run it with `cargo run -- seed`. It refuses to touch a database that
//! already holds workers unless `--force` is passed.

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime, Weekday};
use rusqlite::{Connection, params};

use crate::error::{AppError, AppResult};

/// Product lines, taken from the item codes on the paper sheet.
const SERIES: [&str; 4] = ["Toilet 3007", "Toilet 3208", "Basin 2010", "Wall Hung 1842"];

const FIRST_NAMES: [&str; 24] = [
    "Ramesh", "Suresh", "Kiran", "Jayesh", "Bhavesh", "Nilesh", "Mahesh", "Dinesh", "Ashok",
    "Vijay", "Pravin", "Hitesh", "Sanjay", "Rajesh", "Manoj", "Alpesh", "Chirag", "Divyesh",
    "Ketan", "Mukesh", "Nitin", "Paresh", "Rakesh", "Tushar",
];

const LAST_NAMES: [&str; 8] =
    ["Patel", "Chauhan", "Solanki", "Parmar", "Rathod", "Vaghela", "Makwana", "Zala"];

/// Relative frequency of each reason, by `sort_order`. Handling and the loader
/// break the most pieces; glazing faults are rare. Anything past the end of
/// this table falls back to a low weight, so a renamed or extended reason list
/// still seeds sensibly.
const REASON_WEIGHTS: [u32; 10] = [18, 8, 16, 9, 20, 7, 6, 3, 11, 5];

pub fn run(connection: &mut Connection, force: bool) -> AppResult<()> {
    let existing: i64 =
        connection.query_row("SELECT COUNT(*) FROM worker", [], |row| row.get(0))?;

    if existing > 0 && !force {
        return Err(AppError::Conflict(format!(
            "This database already has {existing} worker(s). \
             Re-run with `seed --force` to clear the waste log, workers and series first."
        )));
    }

    let transaction = connection.transaction()?;

    if force {
        // Reasons survive: they are the sheet's columns, and the operator may
        // already have renamed them to match their own register.
        transaction.execute("DELETE FROM worker_log", [])?;
        transaction.execute("DELETE FROM worker", [])?;
        transaction.execute("DELETE FROM series_of_product", [])?;
        tracing::info!("cleared existing waste log, workers and series");
    }

    let now = crate::now();
    let mut rng = Rng::new(0x5EED_1234_ABCD_0001);

    // ------------------------------------------------------------- series ---
    let mut series_ids = Vec::with_capacity(SERIES.len());
    for name in SERIES {
        transaction.execute(
            "INSERT INTO series_of_product (name, created_date, modified_date) VALUES (?1, ?2, ?2)",
            params![name, now],
        )?;
        series_ids.push(transaction.last_insert_rowid());
    }

    // ------------------------------------------------------------ workers ---
    let mut worker_ids = Vec::with_capacity(FIRST_NAMES.len());
    for (index, first_name) in FIRST_NAMES.iter().enumerate() {
        let last_name = LAST_NAMES[index % LAST_NAMES.len()];
        // A few workers have no number on file, which is what the optional
        // phone column is there for.
        let phone = if index % 5 == 3 {
            None
        } else {
            Some(format!("98{}", 25010000 + (index as u64) * 137_913))
        };

        transaction.execute(
            "INSERT INTO worker (first_name, last_name, phone, series_of_product_id,
                                 created_date, modified_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![first_name, last_name, phone, series_ids[index % series_ids.len()], now],
        )?;
        worker_ids.push(transaction.last_insert_rowid());
    }

    // ------------------------------------------------------------ reasons ---
    let reasons: Vec<i64> = {
        let mut statement = transaction.prepare("SELECT id FROM reason ORDER BY sort_order, id")?;
        let ids = statement.query_map([], |row| row.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        ids
    };

    if reasons.is_empty() {
        return Err(AppError::Internal(
            "No reasons exist to log waste against — the database was not initialised.".to_string(),
        ));
    }

    let picker = WeightedPicker::new(&reasons);

    // -------------------------------------------------------- waste taps ---
    // From the first of last month to today, so both the current period and
    // the "Last month" preset land on a full sheet.
    let today = Local::now().date_naive();
    let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .and_then(|first| first.checked_sub_months(chrono::Months::new(1)))
        .unwrap_or(today);

    let mut entries = 0_u32;
    let mut day = start;

    while day <= today {
        // Sunday is off, and no shift runs on a day that has not happened yet.
        if day.weekday() != Weekday::Sun {
            let breakages = rng.range(6, 26);

            for _ in 0..breakages {
                let worker_id = worker_ids[rng.below(worker_ids.len())];
                let reason_id = picker.pick(&mut rng);

                // Grade 3 is the more common salvage grade; grade 4 is scrap.
                let (grade3, grade4) = if rng.chance(58) { (1, 0) } else { (0, 1) };

                let logged = shift_time(day, &mut rng);
                let stamp = logged.format("%Y-%m-%d %H:%M:%S").to_string();

                transaction.execute(
                    "INSERT INTO worker_log (worker_id, grade3, grade4, reason_id,
                                             created_date, modified_date)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![worker_id, grade3, grade4, reason_id, stamp],
                )?;
                entries += 1;
            }
        }

        day += Duration::days(1);
    }

    transaction.commit()?;

    tracing::info!(
        series = SERIES.len(),
        workers = worker_ids.len(),
        reasons = reasons.len(),
        entries,
        from = %start,
        to = %today,
        "seeded demo data",
    );

    println!(
        "Seeded {} series, {} workers and {entries} waste entries from {start} to {today}.",
        SERIES.len(),
        worker_ids.len(),
    );

    Ok(())
}

/// A timestamp inside the working day, so the entry history reads plausibly.
fn shift_time(day: NaiveDate, rng: &mut Rng) -> NaiveDateTime {
    let hour = rng.range(8, 19) as u32;
    let minute = rng.range(0, 59) as u32;
    let second = rng.range(0, 59) as u32;

    day.and_hms_opt(hour, minute, second)
        .unwrap_or_else(|| day.and_hms_opt(12, 0, 0).expect("noon is a valid time"))
}

/// Picks reason ids in proportion to `REASON_WEIGHTS`, so the report's
/// "by reason" breakdown has a shape instead of being flat noise.
struct WeightedPicker {
    /// `(cumulative_weight, reason_id)`, ascending.
    cumulative: Vec<(u32, i64)>,
    total: u32,
}

impl WeightedPicker {
    fn new(reason_ids: &[i64]) -> Self {
        let mut cumulative = Vec::with_capacity(reason_ids.len());
        let mut total = 0;

        for (index, id) in reason_ids.iter().enumerate() {
            total += REASON_WEIGHTS.get(index).copied().unwrap_or(4);
            cumulative.push((total, *id));
        }

        WeightedPicker { cumulative, total }
    }

    fn pick(&self, rng: &mut Rng) -> i64 {
        let roll = (rng.next_u64() % u64::from(self.total)) as u32;
        for (threshold, id) in &self.cumulative {
            if roll < *threshold {
                return *id;
            }
        }
        self.cumulative.last().expect("at least one reason").1
    }
}

/// A tiny xorshift generator. Deterministic on purpose — re-seeding a fresh
/// database gives the same demo every time — and it saves pulling in `rand`
/// for something only the seeder needs.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, bound: usize) -> usize {
        (self.next_u64() % bound as u64) as usize
    }

    /// Inclusive on both ends.
    fn range(&mut self, low: i64, high: i64) -> i64 {
        low + (self.next_u64() % ((high - low + 1) as u64)) as i64
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.next_u64() % 100 < percent
    }
}
