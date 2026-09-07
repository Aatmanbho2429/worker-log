use serde::Serialize;

use crate::error::{AppError, AppResult};

/// The envelope every command answers with — success or failure alike — per
/// `.claude/rules/api-response-format.md`. A command never rejects the
/// `invoke` promise; `web/src/app/core/zone-wrapper/zone-wrapper.service.ts`
/// is what turns a non-2xx `statusCode` back into a thrown error on the JS
/// side, so nothing above that one file has to know this type exists.
///
/// `data` is `None` on failure — there is no meaningful `T` to put there —
/// which is why every command still does its real work in a `*_impl` function
/// returning the ordinary [`AppResult<T>`] and only converts at the very end,
/// the same `?`-based error handling as before.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse<T> {
    pub status_code: u16,
    pub message: String,
    pub data: Option<T>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        ApiResponse { status_code: 200, message: "OK".to_string(), data: Some(data) }
    }
}

impl<T> From<AppError> for ApiResponse<T> {
    fn from(err: AppError) -> Self {
        // The one place this used to happen: `AppError`'s old `Serialize` impl
        // logged here before turning itself into the shape the front end reads.
        if matches!(err, AppError::Database(_) | AppError::Internal(_)) {
            log::error!("command failed: {err}");
        }

        ApiResponse { status_code: err.status_code(), message: err.to_string(), data: None }
    }
}

impl<T> From<AppResult<T>> for ApiResponse<T> {
    fn from(result: AppResult<T>) -> Self {
        match result {
            Ok(data) => ApiResponse::ok(data),
            Err(err) => ApiResponse::from(err),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_carries_the_data_and_a_200() {
        let response = ApiResponse::ok(42);
        assert_eq!(response.status_code, 200);
        assert_eq!(response.data, Some(42));
    }

    /// The mapping the front end relies on to tell a fixable warning from a
    /// fault — see `notify.service.ts`'s `fromCommand`.
    #[test]
    fn every_error_kind_maps_to_its_status_and_drops_the_data() {
        let cases: [(AppError, u16); 5] = [
            (AppError::BadRequest("bad".into()), 400),
            (AppError::NotFound("missing".into()), 404),
            (AppError::Conflict("clash".into()), 409),
            (AppError::Internal("broken".into()), 500),
            (AppError::Database(rusqlite::Error::QueryReturnedNoRows), 500),
        ];

        for (err, expected_status) in cases {
            let expected_message = err.to_string();
            let response: ApiResponse<i32> = err.into();
            assert_eq!(response.status_code, expected_status);
            assert_eq!(response.message, expected_message);
            assert_eq!(response.data, None);
        }
    }

    #[test]
    fn an_app_result_converts_the_same_way_a_bare_error_does() {
        let ok: AppResult<&str> = Ok("fine");
        let response: ApiResponse<&str> = ok.into();
        assert_eq!(response.status_code, 200);
        assert_eq!(response.data, Some("fine"));

        let err: AppResult<&str> = Err(AppError::Conflict("already exists".into()));
        let response: ApiResponse<&str> = err.into();
        assert_eq!(response.status_code, 409);
        assert_eq!(response.data, None);
    }
}
