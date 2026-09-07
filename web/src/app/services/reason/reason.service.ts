import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { Reason, ReasonPayload } from '../../models';

/** The `reason` CRUD commands. */
@Injectable({ providedIn: 'root' })
export class ReasonService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  list(): Promise<Reason[]> {
    return this.zoneWrapper.invoke<Reason[]>(TAURI_COMMANDS.listReasons);
  }

  create(payload: ReasonPayload): Promise<Reason> {
    return this.zoneWrapper.invoke<Reason>(TAURI_COMMANDS.createReason, { payload });
  }

  update(id: number, payload: ReasonPayload): Promise<Reason> {
    return this.zoneWrapper.invoke<Reason>(TAURI_COMMANDS.updateReason, { id, payload });
  }

  delete(id: number): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.deleteReason, { id });
  }
}
