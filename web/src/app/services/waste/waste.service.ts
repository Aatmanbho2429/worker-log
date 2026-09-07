import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { Dashboard, LogEntryPayload, RangeFilter, WorkerLog } from '../../models';

/**
 * The waste dashboard, the audit trail behind it, and its exports.
 *
 * The range travels with each request as a plain `{ from, to, seriesId }`
 * object, matching `RangeQuery` in Rust.
 */
@Injectable({ providedIn: 'root' })
export class WasteService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  dashboard(filter: RangeFilter): Promise<Dashboard> {
    return this.zoneWrapper.invoke<Dashboard>(TAURI_COMMANDS.wasteDashboard, { range: filter });
  }

  logs(filter: RangeFilter, workerId?: number | null): Promise<WorkerLog[]> {
    return this.zoneWrapper.invoke<WorkerLog[]>(TAURI_COMMANDS.wasteLogs, {
      range: filter,
      workerId: workerId ?? null,
    });
  }

  /** One tap of a grade button. */
  addEntry(payload: LogEntryPayload): Promise<WorkerLog> {
    return this.zoneWrapper.invoke<WorkerLog>(TAURI_COMMANDS.addWasteEntry, { entry: payload });
  }

  /**
   * Undoes the most recent matching tap. The range travels with the call so
   * the backend only ever removes an entry from the period on screen.
   */
  undoEntry(payload: LogEntryPayload, filter: RangeFilter): Promise<WorkerLog> {
    return this.zoneWrapper.invoke<WorkerLog>(TAURI_COMMANDS.undoWasteEntry, {
      entry: payload,
      range: filter,
    });
  }

  /** Writes the sheet to `path`; the caller supplies it from the save dialog. */
  exportPdf(filter: RangeFilter, path: string): Promise<string> {
    return this.zoneWrapper.invoke<string>(TAURI_COMMANDS.exportWastePdf, { range: filter, path });
  }

  exportCsv(filter: RangeFilter, path: string): Promise<string> {
    return this.zoneWrapper.invoke<string>(TAURI_COMMANDS.exportWasteCsv, { range: filter, path });
  }
}
