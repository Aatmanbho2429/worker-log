/**
 * `update_check`'s answer when a newer signed release exists. Mirrors
 * `src-tauri/src/models/response/update_info.rs`'s `UpdateInfo`.
 *
 * `update_check` returns `UpdateInfo | null` — `null` means the app is
 * already current, the same shape `auth_restore`/`auth_validate` use for
 * "nothing to report".
 */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string;
}
