//! Code 128 barcodes for the scanning sheet.
//!
//! Every grade button on the waste screen gets a barcode. Scanning it records
//! exactly what tapping it records — one `worker_log` row for that worker,
//! that reason and that grade — so a reader can replace the tap without the
//! operator having to hold anything in their head.
//!
//! That means one barcode per worker x reason x grade, which is a lot of
//! barcodes; the sheet deals with the volume by showing one reason at a time,
//! the same way the waste screen does.
//!
//! The codes themselves live in the `barcode` table — a row per button, so
//! what is printed and what a scan resolves to are the same record. This
//! module owns how a code is *made*: the digits, the check digit and the bars.
//! The encoder is here rather than in the front end because the same bars have
//! to come out of the screen and the PDF, and two implementations would
//! eventually disagree.
//!
//! Payloads are 12 digits so the whole symbol fits Code 128's subset C, which
//! packs two digits per symbol and keeps the printed bars narrow:
//!
//! ```text
//! 3 wwwww rrrr g c
//! | |     |    | \ check digit
//! | |     |    \-- grade id
//! | |     \------- reason id
//! | \------------- worker id
//! \--------------- format marker, so a carton barcode is rejected outright
//! ```
//!
//! The grade field is one digit because it used to carry the grade *number*,
//! 3 or 4. Grades are rows now, and the two the register ships with are seeded
//! with the ids 3 and 4 precisely so a sheet printed before that change still
//! scans. The cost is a ceiling of nine grades, which [`MAX_GRADE_ID`] states
//! and the Grades screen refuses past — a factory sorting breakages into ten
//! grades wants a wider payload, not a silently unprintable button.

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Widths of the bars and spaces of every Code 128 symbol, indexed by value.
///
/// Each entry alternates bar, space, bar, space, bar, space and sums to 11
/// modules; the stop pattern at 106 is the one exception, with a seventh
/// element and 13 modules.
const PATTERNS: [&[u8]; 107] = [
    &[2, 1, 2, 2, 2, 2], &[2, 2, 2, 1, 2, 2], &[2, 2, 2, 2, 2, 1], &[1, 2, 1, 2, 2, 3],
    &[1, 2, 1, 3, 2, 2], &[1, 3, 1, 2, 2, 2], &[1, 2, 2, 2, 1, 3], &[1, 2, 2, 3, 1, 2],
    &[1, 3, 2, 2, 1, 2], &[2, 2, 1, 2, 1, 3], &[2, 2, 1, 3, 1, 2], &[2, 3, 1, 2, 1, 2],
    &[1, 1, 2, 2, 3, 2], &[1, 2, 2, 1, 3, 2], &[1, 2, 2, 2, 3, 1], &[1, 1, 3, 2, 2, 2],
    &[1, 2, 3, 1, 2, 2], &[1, 2, 3, 2, 2, 1], &[2, 2, 3, 2, 1, 1], &[2, 2, 1, 1, 3, 2],
    &[2, 2, 1, 2, 3, 1], &[2, 1, 3, 2, 1, 2], &[2, 2, 3, 1, 1, 2], &[3, 1, 2, 1, 3, 1],
    &[3, 1, 1, 2, 2, 2], &[3, 2, 1, 1, 2, 2], &[3, 2, 1, 2, 2, 1], &[3, 1, 2, 2, 1, 2],
    &[3, 2, 2, 1, 1, 2], &[3, 2, 2, 2, 1, 1], &[2, 1, 2, 1, 2, 3], &[2, 1, 2, 3, 2, 1],
    &[2, 3, 2, 1, 2, 1], &[1, 1, 1, 3, 2, 3], &[1, 3, 1, 1, 2, 3], &[1, 3, 1, 3, 2, 1],
    &[1, 1, 2, 3, 1, 3], &[1, 3, 2, 1, 1, 3], &[1, 3, 2, 3, 1, 1], &[2, 1, 1, 3, 1, 3],
    &[2, 3, 1, 1, 1, 3], &[2, 3, 1, 3, 1, 1], &[1, 1, 2, 1, 3, 3], &[1, 1, 2, 3, 3, 1],
    &[1, 3, 2, 1, 3, 1], &[1, 1, 3, 1, 2, 3], &[1, 1, 3, 3, 2, 1], &[1, 3, 3, 1, 2, 1],
    &[3, 1, 3, 1, 2, 1], &[2, 1, 1, 3, 3, 1], &[2, 3, 1, 1, 3, 1], &[2, 1, 3, 1, 1, 3],
    &[2, 1, 3, 3, 1, 1], &[2, 1, 3, 1, 3, 1], &[3, 1, 1, 1, 2, 3], &[3, 1, 1, 3, 2, 1],
    &[3, 3, 1, 1, 2, 1], &[3, 1, 2, 1, 1, 3], &[3, 1, 2, 3, 1, 1], &[3, 3, 2, 1, 1, 1],
    &[3, 1, 4, 1, 1, 1], &[2, 2, 1, 4, 1, 1], &[4, 3, 1, 1, 1, 1], &[1, 1, 1, 2, 2, 4],
    &[1, 1, 1, 4, 2, 2], &[1, 2, 1, 1, 2, 4], &[1, 2, 1, 4, 2, 1], &[1, 4, 1, 1, 2, 2],
    &[1, 4, 1, 2, 2, 1], &[1, 1, 2, 2, 1, 4], &[1, 1, 2, 4, 1, 2], &[1, 2, 2, 1, 1, 4],
    &[1, 2, 2, 4, 1, 1], &[1, 4, 2, 1, 1, 2], &[1, 4, 2, 2, 1, 1], &[2, 4, 1, 2, 1, 1],
    &[2, 2, 1, 1, 1, 4], &[4, 1, 3, 1, 1, 1], &[2, 4, 1, 1, 1, 2], &[1, 3, 4, 1, 1, 1],
    &[1, 1, 1, 2, 4, 2], &[1, 2, 1, 1, 4, 2], &[1, 2, 1, 2, 4, 1], &[1, 1, 4, 2, 1, 2],
    &[1, 2, 4, 1, 1, 2], &[1, 2, 4, 2, 1, 1], &[4, 1, 1, 2, 1, 2], &[4, 2, 1, 1, 1, 2],
    &[4, 2, 1, 2, 1, 1], &[2, 1, 2, 1, 4, 1], &[2, 1, 4, 1, 2, 1], &[4, 1, 2, 1, 2, 1],
    &[1, 1, 1, 1, 4, 3], &[1, 1, 1, 3, 4, 1], &[1, 3, 1, 1, 4, 1], &[1, 1, 4, 1, 1, 3],
    &[1, 1, 4, 3, 1, 1], &[4, 1, 1, 1, 1, 3], &[4, 1, 1, 3, 1, 1], &[1, 1, 3, 1, 4, 1],
    &[1, 1, 4, 1, 3, 1], &[3, 1, 1, 1, 4, 1], &[4, 1, 1, 1, 3, 1], &[2, 1, 1, 4, 1, 2],
    &[2, 1, 1, 2, 1, 4], &[2, 1, 1, 2, 3, 2], &[2, 3, 3, 1, 1, 1, 2],
];

/// Subset C, where each symbol carries two digits.
const START_C: usize = 105;
const STOP: usize = 106;

/// The quiet zone either side of the symbol, in modules. Below ten the scanner
/// starts missing reads on a busy sheet.
pub const QUIET_ZONE: u32 = 10;

/// One grade button: the entry a single scan records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scan {
    pub worker_id: i64,
    pub reason_id: i64,
    pub grade_id: i64,
}

/// The widest id each field can carry. A factory that outgrows these has
/// bigger problems than its barcodes, but a silently over-long payload would
/// print a barcode that never scans back, so it is refused instead.
const MAX_WORKER_ID: i64 = 99_999;
const MAX_REASON_ID: i64 = 9_999;
/// The widest grade id the single grade digit can carry.
pub const MAX_GRADE_ID: i64 = 9;

const MARKER: char = '3';

/// The bars of one barcode, ready to be drawn as rectangles.
///
/// `modules` alternates bar, space, bar, space ... starting with a bar, each
/// entry a width in modules. The renderer decides what a module is worth in
/// pixels or points, which is the only thing that differs between the screen
/// and the PDF.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    /// The digits encoded, shown as human-readable text under the bars.
    pub code: String,
    pub modules: Vec<u8>,
    /// Total width including both quiet zones, so callers can scale to fit.
    pub module_count: u32,
}

impl Scan {
    /// The 12-digit payload this entry is carried by.
    pub fn payload(self) -> AppResult<String> {
        if self.worker_id < 1 || self.worker_id > MAX_WORKER_ID {
            return Err(AppError::Internal(format!(
                "Worker id {} cannot be put on a barcode.",
                self.worker_id
            )));
        }
        if self.reason_id < 1 || self.reason_id > MAX_REASON_ID {
            return Err(AppError::Internal(format!(
                "Reason id {} cannot be put on a barcode.",
                self.reason_id
            )));
        }
        if self.grade_id < 1 || self.grade_id > MAX_GRADE_ID {
            return Err(AppError::Internal(format!(
                "Grade id {} cannot be put on a barcode.",
                self.grade_id
            )));
        }

        let body =
            format!("{MARKER}{:05}{:04}{}", self.worker_id, self.reason_id, self.grade_id);
        Ok(format!("{body}{}", check_digit(&body)))
    }

    /// Reads a payload back, rejecting anything that is not one of ours.
    ///
    /// Scanners are pointed at whatever is in front of them, so a barcode off a
    /// passing carton has to be a normal outcome rather than a fault. The ids
    /// this returns are what the digits *claim*; the row in `barcode` is what
    /// a scan is actually recorded against.
    pub fn parse(raw: &str) -> AppResult<Self> {
        let code = raw.trim();
        let invalid = || AppError::BadRequest(format!("`{code}` is not a waste log barcode."));

        if code.len() != 12 || !code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(invalid());
        }
        if !code.starts_with(MARKER) {
            return Err(invalid());
        }

        let (body, check) = code.split_at(11);
        if check_digit(body).to_string() != check {
            return Err(AppError::BadRequest(format!(
                "Barcode `{code}` did not read cleanly. Try scanning it again."
            )));
        }

        let digits = |range: std::ops::Range<usize>| -> i64 {
            body[range].parse::<i64>().unwrap_or_default()
        };

        Ok(Scan {
            worker_id: digits(1..6),
            reason_id: digits(6..10),
            grade_id: digits(10..11),
        })
    }
}

/// A weighted mod-10 digit, so a misread or a stray 8-digit barcode from some
/// other system is rejected rather than silently logged against a worker.
fn check_digit(body: &str) -> u8 {
    let sum: u32 = body
        .bytes()
        .enumerate()
        .map(|(index, byte)| {
            let digit = u32::from(byte - b'0');
            if index % 2 == 0 { digit * 3 } else { digit }
        })
        .sum();
    ((10 - (sum % 10)) % 10) as u8
}

/// Encodes an even-length run of digits as Code 128 subset C.
///
/// Panics only on input this module does not generate; every caller passes a
/// stored `barcode.barcode`, which `Scan::payload` built as 12 digits.
pub fn encode(digits: &str) -> Symbol {
    debug_assert!(digits.len() % 2 == 0 && digits.bytes().all(|b| b.is_ascii_digit()));

    let mut values = vec![START_C];
    for pair in digits.as_bytes().chunks(2) {
        let value = (pair[0] - b'0') as usize * 10 + (pair[1] - b'0') as usize;
        values.push(value);
    }

    // The symbol check character weights each value by its position, counting
    // the start character as position zero.
    let checksum = values
        .iter()
        .enumerate()
        .map(|(index, value)| value * index.max(1))
        .sum::<usize>()
        % 103;
    values.push(checksum);
    values.push(STOP);

    let modules: Vec<u8> = values.iter().flat_map(|&value| PATTERNS[value]).copied().collect();
    let module_count = modules.iter().map(|&width| u32::from(width)).sum::<u32>() + QUIET_ZONE * 2;

    Symbol { code: digits.to_string(), modules, module_count }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_round_trip() {
        for scan in [
            Scan { worker_id: 1, reason_id: 1, grade_id: 3 },
            Scan { worker_id: 24, reason_id: 7, grade_id: 4 },
            Scan { worker_id: 99_999, reason_id: 9_999, grade_id: MAX_GRADE_ID },
        ] {
            let payload = scan.payload().unwrap();
            assert_eq!(payload.len(), 12, "{payload} should be 12 digits");
            assert_eq!(Scan::parse(&payload).unwrap(), scan);
        }
    }

    /// Every button on the sheet must get its own barcode: if two combinations
    /// ever collided, a scan would silently log against the wrong worker.
    #[test]
    fn every_button_gets_a_distinct_payload() {
        let mut seen = std::collections::HashSet::new();
        for worker_id in 1..=40 {
            for reason_id in 1..=12 {
                for grade_id in [3, 4] {
                    let scan = Scan { worker_id, reason_id, grade_id };
                    assert!(seen.insert(scan.payload().unwrap()), "collision at {scan:?}");
                }
            }
        }
        assert_eq!(seen.len(), 40 * 12 * 2);
    }

    #[test]
    fn ids_too_large_to_encode_are_refused() {
        let scan = Scan { worker_id: 100_000, reason_id: 1, grade_id: 3 };
        assert!(scan.payload().is_err());
        let scan = Scan { worker_id: 1, reason_id: 10_000, grade_id: 3 };
        assert!(scan.payload().is_err());
        let scan = Scan { worker_id: 1, reason_id: 1, grade_id: MAX_GRADE_ID + 1 };
        assert!(scan.payload().is_err());
    }

    #[test]
    fn foreign_and_damaged_barcodes_are_rejected() {
        // A carton barcode: right length, wrong marker.
        assert!(Scan::parse("500123456789").is_err());
        // Our shape, but a digit misread.
        let mut damaged =
            Scan { worker_id: 12, reason_id: 3, grade_id: 4 }.payload().unwrap().into_bytes();
        damaged[4] = if damaged[4] == b'9' { b'8' } else { damaged[4] + 1 };
        assert!(Scan::parse(std::str::from_utf8(&damaged).unwrap()).is_err());
        assert!(Scan::parse("").is_err());
        assert!(Scan::parse("abcdefghijkl").is_err());
    }

    /// A transcription slip in the pattern table would break real scanners
    /// while still looking like a perfectly plausible barcode on screen, so
    /// check it against the structural rules of the symbology: every symbol is
    /// 11 modules wide, bar-first, except the stop pattern's 13; every symbol's
    /// bars total an even number of modules, which is what makes Code 128
    /// self-checking; and no two symbols share a pattern.
    #[test]
    fn pattern_table_is_well_formed() {
        for (value, pattern) in PATTERNS.iter().enumerate() {
            let width: u8 = pattern.iter().sum();
            if value == STOP {
                assert_eq!((pattern.len(), width), (7, 13), "stop pattern");
            } else {
                assert_eq!((pattern.len(), width), (6, 11), "pattern {value}");
                let bars: u8 = pattern.iter().step_by(2).sum();
                assert_eq!(bars % 2, 0, "pattern {value} has odd bar parity");
            }
        }

        for (value, pattern) in PATTERNS.iter().enumerate() {
            let twin = PATTERNS.iter().position(|other| other == pattern);
            assert_eq!(twin, Some(value), "pattern {value} is duplicated");
        }

        // Anchors against the published table, in the notation it is printed in.
        assert_eq!(PATTERNS[103], &[2, 1, 1, 4, 1, 2], "start A");
        assert_eq!(PATTERNS[104], &[2, 1, 1, 2, 1, 4], "start B");
        assert_eq!(PATTERNS[START_C], &[2, 1, 1, 2, 3, 2], "start C");
        assert_eq!(PATTERNS[STOP], &[2, 3, 3, 1, 1, 1, 2], "stop");
    }

    /// Subset C splits "042184" into the values 4, 21 and 84, and the symbol
    /// check character weights each by its position:
    /// `(105 + 1*4 + 2*21 + 3*84) mod 103 = 94`.
    #[test]
    fn checksum_is_position_weighted() {
        let symbol = encode("042184");
        let expected: Vec<u8> = [START_C, 4, 21, 84, 94, STOP]
            .iter()
            .flat_map(|&value| PATTERNS[value])
            .copied()
            .collect();
        assert_eq!(symbol.modules, expected);
    }
}
