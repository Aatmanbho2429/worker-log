import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { Grade, GradeDeleteImpact, GradePayload } from '../../models';

/** The `grade` CRUD commands. */
@Injectable({ providedIn: 'root' })
export class GradeService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  list(): Promise<Grade[]> {
    return this.zoneWrapper.invoke<Grade[]>(TAURI_COMMANDS.listGrades);
  }

  create(payload: GradePayload): Promise<Grade> {
    return this.zoneWrapper.invoke<Grade>(TAURI_COMMANDS.createGrade, { payload });
  }

  update(id: number, payload: GradePayload): Promise<Grade> {
    return this.zoneWrapper.invoke<Grade>(TAURI_COMMANDS.updateGrade, { id, payload });
  }

  /** How many printed barcodes a delete would take off the sheet. */
  deleteImpact(id: number): Promise<GradeDeleteImpact> {
    return this.zoneWrapper.invoke<GradeDeleteImpact>(TAURI_COMMANDS.gradeDeleteImpact, { id });
  }

  delete(id: number): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.deleteGrade, { id });
  }
}
