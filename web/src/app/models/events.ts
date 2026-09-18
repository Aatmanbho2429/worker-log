/** Mirrors `events::ChangeScope`. */
export type ChangeScope = 'waste' | 'workers' | 'series' | 'reasons' | 'grades' | 'everything';

/** Mirrors `events::DataChanged`. */
export interface DataChanged {
  scope: ChangeScope;
  message: string | null;
}

/**
 * Whether a screen showing `interested` data should reload for this change.
 * `everything` matches all of them; a waste tap does not disturb the masters.
 */
export function affects(change: DataChanged, ...interested: ChangeScope[]): boolean {
  return change.scope === 'everything' || interested.includes(change.scope);
}

/** Mirrors `events::UpdatePhase`. */
export type UpdatePhase = 'downloading' | 'installing';

/**
 * Download/install progress for an in-progress update install. Mirrors
 * `events::UpdateProgress` in Rust.
 */
export interface UpdateProgress {
  downloaded: number;
  /** `null` when the response carried no `Content-Length` — an indeterminate download. */
  total: number | null;
  phase: UpdatePhase;
}
