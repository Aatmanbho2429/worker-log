import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  BarcodeSheet,
  Dashboard,
  Grade,
  GradeDeleteImpact,
  GradePayload,
  LogEntryPayload,
  RangeFilter,
  Reason,
  ReasonPayload,
  ScanReceipt,
  SeriesOfProduct,
  SeriesPayload,
  Worker,
  WorkerDeleteImpact,
  WorkerLog,
  WorkerPayload,
} from '../models';
import { DATA_CHANGED, DataChanged } from '../models/events';
import { TauriService } from './tauri.service';

export interface AppInfo {
  version: string;
  databasePath: string;
}

/**
 * Every call the front end can make into the Rust side.
 *
 * The range travels with each request as a plain `{ from, to, seriesId }`
 * object, matching `RangeQuery` in Rust.
 */
@Injectable({ providedIn: 'root' })
export class WasteLogService {
  private readonly tauri = inject(TauriService);

  /** Fires whenever the backend changes something. */
  readonly changes: Observable<DataChanged> = this.tauri.on<DataChanged>(DATA_CHANGED);

  appInfo(): Promise<AppInfo> {
    return this.tauri.call<AppInfo>('app_info');
  }

  // ------------------------------------------------------------- series ---

  listSeries(): Promise<SeriesOfProduct[]> {
    return this.tauri.call<SeriesOfProduct[]>('list_series');
  }

  createSeries(payload: SeriesPayload): Promise<SeriesOfProduct> {
    return this.tauri.call<SeriesOfProduct>('create_series', { payload });
  }

  updateSeries(id: number, payload: SeriesPayload): Promise<SeriesOfProduct> {
    return this.tauri.call<SeriesOfProduct>('update_series', { id, payload });
  }

  deleteSeries(id: number): Promise<void> {
    return this.tauri.call<void>('delete_series', { id });
  }

  // ------------------------------------------------------------ reasons ---

  listReasons(): Promise<Reason[]> {
    return this.tauri.call<Reason[]>('list_reasons');
  }

  createReason(payload: ReasonPayload): Promise<Reason> {
    return this.tauri.call<Reason>('create_reason', { payload });
  }

  updateReason(id: number, payload: ReasonPayload): Promise<Reason> {
    return this.tauri.call<Reason>('update_reason', { id, payload });
  }

  deleteReason(id: number): Promise<void> {
    return this.tauri.call<void>('delete_reason', { id });
  }

  // ------------------------------------------------------------- grades ---

  listGrades(): Promise<Grade[]> {
    return this.tauri.call<Grade[]>('list_grades');
  }

  createGrade(payload: GradePayload): Promise<Grade> {
    return this.tauri.call<Grade>('create_grade', { payload });
  }

  updateGrade(id: number, payload: GradePayload): Promise<Grade> {
    return this.tauri.call<Grade>('update_grade', { id, payload });
  }

  /** How many printed barcodes a delete would take off the sheet. */
  gradeDeleteImpact(id: number): Promise<GradeDeleteImpact> {
    return this.tauri.call<GradeDeleteImpact>('grade_delete_impact', { id });
  }

  deleteGrade(id: number): Promise<void> {
    return this.tauri.call<void>('delete_grade', { id });
  }

  // ------------------------------------------------------------ workers ---

  listWorkers(seriesId?: number | null): Promise<Worker[]> {
    return this.tauri.call<Worker[]>('list_workers', { seriesId: seriesId ?? null });
  }

  createWorker(payload: WorkerPayload): Promise<Worker> {
    return this.tauri.call<Worker>('create_worker', { payload });
  }

  updateWorker(id: number, payload: WorkerPayload): Promise<Worker> {
    return this.tauri.call<Worker>('update_worker', { id, payload });
  }

  /** How much history a delete would take with it. */
  workerDeleteImpact(id: number): Promise<WorkerDeleteImpact> {
    return this.tauri.call<WorkerDeleteImpact>('worker_delete_impact', { id });
  }

  deleteWorker(id: number): Promise<void> {
    return this.tauri.call<void>('delete_worker', { id });
  }

  // -------------------------------------------------------------- waste ---

  dashboard(filter: RangeFilter): Promise<Dashboard> {
    return this.tauri.call<Dashboard>('waste_dashboard', { range: filter });
  }

  logs(filter: RangeFilter, workerId?: number | null): Promise<WorkerLog[]> {
    return this.tauri.call<WorkerLog[]>('waste_logs', {
      range: filter,
      workerId: workerId ?? null,
    });
  }

  /** One tap of a grade button. */
  addEntry(payload: LogEntryPayload): Promise<WorkerLog> {
    return this.tauri.call<WorkerLog>('add_waste_entry', { entry: payload });
  }

  /**
   * Undoes the most recent matching tap. The range travels with the call so
   * the backend only ever removes an entry from the period on screen.
   */
  undoEntry(payload: LogEntryPayload, filter: RangeFilter): Promise<WorkerLog> {
    return this.tauri.call<WorkerLog>('undo_waste_entry', {
      entry: payload,
      range: filter,
    });
  }

  // ------------------------------------------------------------ exports ---

  /** Writes the sheet to `path`; the caller supplies it from the save dialog. */
  exportPdf(filter: RangeFilter, path: string): Promise<string> {
    return this.tauri.call<string>('export_waste_pdf', { range: filter, path });
  }

  exportCsv(filter: RangeFilter, path: string): Promise<string> {
    return this.tauri.call<string>('export_waste_csv', { range: filter, path });
  }

  // --------------------------------------------------------------- demo ---

  seedDemoData(force: boolean): Promise<string> {
    return this.tauri.call<string>('seed_demo_data', { force });
  }

  // ------------------------------------------------------------ barcodes ---

  barcodeSheet(seriesId: number | null): Promise<BarcodeSheet> {
    return this.tauri.call<BarcodeSheet>('barcode_sheet', { seriesId });
  }

  /**
   * Records the entry a scanned barcode stands for. The barcode is the grade
   * button, so this does exactly what {@link addEntry} does for a tap.
   */
  recordScan(code: string): Promise<ScanReceipt> {
    return this.tauri.call<ScanReceipt>('record_scan', { code });
  }

  exportBarcodesPdf(seriesId: number | null, path: string): Promise<string> {
    return this.tauri.call<string>('export_barcodes_pdf', { seriesId, path });
  }
}
