use serde::Serialize;

/// `update_check`'s answer when a newer signed release exists. `None` (see
/// the command's `Option<UpdateInfo>` return type) means the app is already
/// current — the same `Option<T>` shape `auth_restore`/`auth_validate` use
/// for "nothing to report".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// The version being offered, e.g. `"0.3.0"`.
    pub version: String,
    /// The version currently running, for a UI that wants to show both.
    pub current_version: String,
    /// The release's notes, verbatim. Empty when the release carries none.
    pub notes: String,
}
