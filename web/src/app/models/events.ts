/** Mirrors `events::DATA_CHANGED` in Rust. */
export const DATA_CHANGED = 'worker-log://data-changed';

/** Mirrors `events::ChangeScope`. */
export type ChangeScope = 'waste' | 'workers' | 'series' | 'reasons' | 'everything';

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
