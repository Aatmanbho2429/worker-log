import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { SeriesOfProduct, SeriesPayload } from '../../models';

/** The `series_of_product` CRUD commands. */
@Injectable({ providedIn: 'root' })
export class SeriesService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  list(): Promise<SeriesOfProduct[]> {
    return this.zoneWrapper.invoke<SeriesOfProduct[]>(TAURI_COMMANDS.listSeries);
  }

  create(payload: SeriesPayload): Promise<SeriesOfProduct> {
    return this.zoneWrapper.invoke<SeriesOfProduct>(TAURI_COMMANDS.createSeries, { payload });
  }

  update(id: number, payload: SeriesPayload): Promise<SeriesOfProduct> {
    return this.zoneWrapper.invoke<SeriesOfProduct>(TAURI_COMMANDS.updateSeries, { id, payload });
  }

  delete(id: number): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.deleteSeries, { id });
  }
}
