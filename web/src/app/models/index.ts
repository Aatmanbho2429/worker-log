export interface SeriesOfProduct {
  id: number;
  name: string;
  createdDate: string;
  modifiedDate: string;
  /** Workers currently assigned, used to explain why a delete is blocked. */
  workerCount: number;
}

export interface Worker {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  seriesOfProductId: number;
  seriesName: string;
  createdDate: string;
  modifiedDate: string;
}

export interface Reason {
  id: number;
  name: string;
  sortOrder: number;
  createdDate: string;
  modifiedDate: string;
}

/**
 * A waste grade — a button on the waste screen, a column on the month sheet
 * and a barcode on the scanning sheet.
 *
 * The register ships with grade 3 and grade 4; screens read the list rather
 * than assuming those two, so a third appears everywhere without further
 * change.
 */
export interface Grade {
  id: number;
  name: string;
  createdDate: string;
  modifiedDate: string;
  /** Waste entries logged against it, used to explain why a delete is blocked. */
  entryCount: number;
}

export interface WorkerLog {
  id: number;
  workerId: number;
  workerName: string;
  reasonId: number;
  reasonName: string;
  gradeId: number;
  gradeName: string;
  createdDate: string;
  modifiedDate: string;
}

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

export interface WorkerDeleteImpact {
  worker: Worker;
  loggedEntries: number;
}

export interface GradeDeleteImpact {
  grade: Grade;
  /** Printed barcodes that would stop working. */
  barcodes: number;
}

export interface SeriesPayload {
  name: string;
}

export interface ReasonPayload {
  name: string;
  sortOrder?: number;
}

export interface GradePayload {
  name: string;
}

export interface WorkerPayload {
  firstName: string;
  lastName: string;
  phone: string | null;
  seriesOfProductId: number;
}

export interface LogEntryPayload {
  workerId: number;
  reasonId: number;
  gradeId: number;
}

/** The date window and series filter every waste screen shares. */
export interface RangeFilter {
  from: string;
  to: string;
  seriesId: number | null;
}

export function workerFullName(worker: Worker): string {
  return `${worker.firstName} ${worker.lastName}`.trim();
}

/** Sums a row of per-grade counts. */
export function sumCounts(counts: readonly number[]): number {
  return counts.reduce((total, count) => total + count, 0);
}

// -------------------------------------------------------------- barcodes ---

/** The bars of one Code 128 symbol, as widths in modules. */
export interface BarcodeSymbol {
  /** The digits encoded, printed under the bars. */
  code: string;
  /** Alternating bar, space, bar, space … starting with a bar. */
  modules: number[];
  /** Total width including both quiet zones, so callers can scale to fit. */
  moduleCount: number;
}

/** One grade's barcode in a worker's row: the button it stands in for. */
export interface BarcodeGradeTile {
  gradeId: number;
  gradeName: string;
  symbol: BarcodeSymbol;
}

export interface BarcodeWorkerRow {
  workerId: number;
  name: string;
  seriesName: string;
  tiles: BarcodeGradeTile[];
}

export interface BarcodeReasonSheet {
  reasonId: number;
  reasonName: string;
  rows: BarcodeWorkerRow[];
}

export interface BarcodeSheet {
  grades: Grade[];
  reasons: BarcodeReasonSheet[];
  seriesName: string | null;
  generatedAt: string;
}

/** What the backend recorded for a scan, echoed back for confirmation. */
export interface ScanReceipt {
  entry: WorkerLog;
}
