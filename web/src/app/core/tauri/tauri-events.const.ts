/** Mirrors `events::DATA_CHANGED`, `events::UPDATE_PROGRESS` and `events::UPDATE_AVAILABLE` in Rust. */
export const TAURI_EVENTS = {
  dataChanged: 'worker-log://data-changed',
  updateProgress: 'worker-log://update-progress',
  updateAvailable: 'worker-log://update-available',
} as const;
