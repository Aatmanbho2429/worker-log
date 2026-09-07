import { Grade } from './grade';
import { Reason } from './reason';
import { Worker } from './worker';

/**
 * Counts for one worker and one reason, one entry per grade.
 *
 * `counts` runs parallel to `Dashboard.grades` — position, not id, is what
 * lines a number up with its column.
 */
export interface DashboardCell {
  reasonId: number;
  counts: number[];
}

export interface DashboardRow {
  worker: Worker;
  /** One cell per reason, in the same order as `Dashboard.reasons`. */
  cells: DashboardCell[];
  /** Row totals, one per grade. */
  total: number[];
}

export interface Dashboard {
  from: string;
  to: string;
  /** The grade columns, in the order every table renders them. */
  grades: Grade[];
  reasons: Reason[];
  rows: DashboardRow[];
  reasonTotals: DashboardCell[];
  /** Sheet totals, one per grade. */
  grandTotal: number[];
}
