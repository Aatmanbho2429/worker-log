//! Request and response models, split by direction per `.claude/rules/models.md`:
//! anything the front end sends is a request, anything it receives is a
//! response. Everything is re-exported flatly here so the rest of the crate
//! keeps writing `crate::models::Grade` rather than reaching into `response::`.

pub mod request;
pub mod response;

pub use request::*;
pub use response::*;

/// Shared by the `*Upsert` request types' `validated()` methods.
pub(crate) fn trimmed(value: &str) -> String {
    value.trim().to_string()
}
