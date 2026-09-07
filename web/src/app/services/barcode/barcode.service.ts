import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { BarcodeSheet, ScanReceipt } from '../../models';

/** The scanning sheet, and recording what a scan stands for. */
@Injectable({ providedIn: 'root' })
export class BarcodeService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  sheet(seriesId: number | null): Promise<BarcodeSheet> {
    return this.zoneWrapper.invoke<BarcodeSheet>(TAURI_COMMANDS.barcodeSheet, { seriesId });
  }

  /**
   * Records the entry a scanned barcode stands for. The barcode is the grade
   * button, so this does exactly what a tap on the waste screen does.
   */
  recordScan(code: string): Promise<ScanReceipt> {
    return this.zoneWrapper.invoke<ScanReceipt>(TAURI_COMMANDS.recordScan, { code });
  }

  exportPdf(seriesId: number | null, path: string): Promise<string> {
    return this.zoneWrapper.invoke<string>(TAURI_COMMANDS.exportBarcodesPdf, { seriesId, path });
  }
}
