export type Grade = 3 | 4;

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

export interface WorkerLog {
  id: number;
  workerId: number;
  workerName: string;
  grade3: number;
  grade4: number;
  reasonId: number;
  reasonName: string;
  createdDate: string;
  modifiedDate: string;
}

export interface GradeCounts {
  grade3: number;
  grade4: number;
}

export interface DashboardCell extends GradeCounts {
  reasonId: number;
}

export interface DashboardRow {
  worker: Worker;
  /** One cell per reason, in the same order as `Dashboard.reasons`. */
  cells: DashboardCell[];
  total: GradeCounts;
}

export interface Dashboard {
  from: string;
  to: string;
  reasons: Reason[];
  rows: DashboardRow[];
  reasonTotals: DashboardCell[];
  grandTotal: GradeCounts;
}

export interface WorkerDeleteImpact {
  worker: Worker;
  loggedEntries: number;
}

export interface SeriesPayload {
  name: string;
}

export interface ReasonPayload {
  name: string;
  sortOrder?: number;
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
  grade: Grade;
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

/** One worker's pair of barcodes under a reason — their two grade buttons. */
export interface BarcodeWorkerRow {
  workerId: number;
  name: string;
  seriesName: string;
  grade3: BarcodeSymbol;
  grade4: BarcodeSymbol;
}

export interface BarcodeReasonSheet {
  reasonId: number;
  reasonName: string;
  rows: BarcodeWorkerRow[];
}

export interface BarcodeSheet {
  reasons: BarcodeReasonSheet[];
  seriesName: string | null;
  generatedAt: string;
}

/** What the backend recorded for a scan, echoed back for confirmation. */
export interface ScanReceipt {
  entry: WorkerLog;
  workerName: string;
  reasonName: string;
  grade: Grade;
}
