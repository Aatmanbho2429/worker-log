import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { Worker, WorkerDeleteImpact, WorkerPayload } from '../../models';

/** The `worker` CRUD commands. */
@Injectable({ providedIn: 'root' })
export class WorkerService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  list(seriesId?: number | null): Promise<Worker[]> {
    return this.zoneWrapper.invoke<Worker[]>(TAURI_COMMANDS.listWorkers, {
      seriesId: seriesId ?? null,
    });
  }

  create(payload: WorkerPayload): Promise<Worker> {
    return this.zoneWrapper.invoke<Worker>(TAURI_COMMANDS.createWorker, { payload });
  }

  update(id: number, payload: WorkerPayload): Promise<Worker> {
    return this.zoneWrapper.invoke<Worker>(TAURI_COMMANDS.updateWorker, { id, payload });
  }

  /** How much history a delete would take with it. */
  deleteImpact(id: number): Promise<WorkerDeleteImpact> {
    return this.zoneWrapper.invoke<WorkerDeleteImpact>(TAURI_COMMANDS.workerDeleteImpact, { id });
  }

  delete(id: number): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.deleteWorker, { id });
  }
}
