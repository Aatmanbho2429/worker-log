import { Injectable, NgZone, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';

import { NotifyService } from '../../core/notify.service';
import { RangeFilter } from '../../models';
import { WasteService } from '../waste/waste.service';

export type ExportFormat = 'pdf' | 'csv';

/**
 * Saving the month sheet to disk.
 *
 * In the browser build this was a link to a download URL. As a desktop app the
 * operator picks the location through the OS save dialog, the backend writes
 * the file, and we offer to open it in whatever the system uses for PDFs.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly waste = inject(WasteService);
  private readonly notify = inject(NotifyService);
  private readonly zone = inject(NgZone);
  private readonly translate = inject(TranslateService);

  async export(filter: RangeFilter, format: ExportFormat): Promise<void> {
    const suggested = `waste-log-${filter.from}-to-${filter.to}.${format}`;

    let path: string | null;
    try {
      // The dialog resolves from the native side, so re-enter the zone with
      // the result rather than trusting where the callback lands.
      const chosen = await this.zone.runOutsideAngular(() =>
        save({
          defaultPath: suggested,
          filters: [
            format === 'pdf'
              ? { name: 'PDF document', extensions: ['pdf'] }
              : { name: 'CSV spreadsheet', extensions: ['csv'] },
          ],
        }),
      );
      path = await this.zone.run(() => chosen);
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('export.saveDialogFailed'));
      return;
    }

    // Cancelled — not an error, and not worth a toast.
    if (!path) {
      return;
    }

    try {
      const written =
        format === 'pdf'
          ? await this.waste.exportPdf(filter, path)
          : await this.waste.exportCsv(filter, path);

      this.notify.success(this.translate.instant('common.savedTo', { path: written }));
      await this.reveal(written);
    } catch (error) {
      this.notify.fromCommand(
        error,
        this.translate.instant('export.writeFailed', { format: format.toUpperCase() }),
      );
    }
  }

  /**
   * Opens the finished file. A failure here is worth a note but not an error:
   * the export itself already succeeded and the file is on disk.
   */
  private async reveal(path: string): Promise<void> {
    try {
      await this.zone.runOutsideAngular(() => openPath(path));
    } catch (error) {
      console.warn('could not open the exported file', error);
      this.notify.info(this.translate.instant('export.openFailed'));
    }
  }
}
