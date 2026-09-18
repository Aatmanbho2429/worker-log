/** Mirrors `events::DATA_CHANGED` and `events::UPDATE_PROGRESS` in Rust. */
export const TAURI_EVENTS = {
  dataChanged: 'worker-log://data-changed',
  updateProgress: 'worker-log://update-progress',
} as const;
