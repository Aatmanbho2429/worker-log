import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { DataChanged } from '../models/events';
import { ZoneWrapperService } from './zone-wrapper/zone-wrapper.service';
import { TAURI_EVENTS } from './tauri/tauri-events.const';

/**
 * The one `worker-log://data-changed` stream, shared across every entity
 * service. Cross-cutting rather than owned by one entity — a worker added
 * matters to `SeriesService`'s consumers as much as `WorkerService`'s — so it
 * lives in `core/` next to the zone wrapper it reads through, not under
 * `services/`.
 */
@Injectable({ providedIn: 'root' })
export class DataChangesService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  readonly changes: Observable<DataChanged> = this.zoneWrapper.listen<DataChanged>(
    TAURI_EVENTS.dataChanged,
  );
}
