import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';

import { DataChangesService } from '../../core/data-changes.service';
import { gradeToneClass } from '../../core/grade-tone';
import { NotifyService } from '../../core/notify.service';
import { GradeService } from '../../services/grade/grade.service';
import { Grade } from '../../models';
import { affects } from '../../models/events';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

/**
 * The grades a broken piece can be sorted into — the buttons on the waste
 * screen and the columns on the month sheet.
 *
 * The register ships with grade 3 and grade 4, the two the paper sheet was
 * ruled for. Adding one here adds a button to every worker's row, a column to
 * every reason on the sheet, and a barcode to the scanning sheet for every
 * worker and reason, so the dialog says so before it is saved.
 */
@Component({
  selector: 'app-grades',
  imports: [PrimengComponentsModule, FormsModule],
  templateUrl: './grades.html',
  styleUrl: './grades.scss',
})
export class Grades {
  private readonly grade = inject(GradeService);
  private readonly dataChanges = inject(DataChangesService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  protected readonly items = signal<Grade[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Grade | null>(null);
  protected readonly name = signal('');
  protected readonly submitted = signal(false);

  protected readonly nameInvalid = computed(() => this.submitted() && !this.name().trim());

  constructor() {
    // The entry count moves with every tap, so a waste change matters here too.
    this.dataChanges.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'grades', 'waste')) {
        void this.load();
      }
    });

    void this.load();
  }

  protected openNew(): void {
    this.editing.set(null);
    this.name.set('');
    this.submitted.set(false);
    this.dialogOpen.set(true);
  }

  protected openEdit(grade: Grade): void {
    this.editing.set(grade);
    this.name.set(grade.name);
    this.submitted.set(false);
    this.dialogOpen.set(true);
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const name = this.name().trim();
    if (!name) {
      return;
    }

    this.saving.set(true);
    const editing = this.editing();

    try {
      if (editing) {
        await this.grade.update(editing.id, { name });
        this.notify.success(this.translate.instant('common.renamedSuccess', { name }));
      } else {
        await this.grade.create({ name });
        this.notify.success(this.translate.instant('grades.addedSuccess', { name }));
      }
      this.dialogOpen.set(false);
      await this.load();
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('grades.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(grade: Grade): Promise<void> {
    // The backend refuses both of these too; catching them here explains why
    // without a round trip that would only come back as an error toast.
    if (grade.entryCount > 0) {
      this.notify.warn(
        this.translate.instant('grades.inUseWarning', {
          name: grade.name,
          count: grade.entryCount,
        }),
      );
      return;
    }
    if (this.items().length <= 1) {
      this.notify.warn(this.translate.instant('grades.lastGradeWarning'));
      return;
    }

    let barcodes = 0;
    try {
      barcodes = (await this.grade.deleteImpact(grade.id)).barcodes;
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('grades.impactFailed'));
      return;
    }

    const printed = barcodes
      ? this.translate.instant('grades.deletePrinted', { count: barcodes })
      : '';

    this.confirm.confirm({
      header: this.translate.instant('grades.deleteHeader'),
      message: this.translate.instant('grades.deleteMessage', { name: grade.name, printed }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('common.delete'),
      rejectLabel: this.translate.instant('common.cancel'),
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: async () => {
        try {
          await this.grade.delete(grade.id);
          this.notify.success(this.translate.instant('common.deletedSuccess', { name: grade.name }));
          await this.load();
        } catch (error) {
          this.notify.fromCommand(error, this.translate.instant('grades.deleteFailed'));
        }
      },
    });
  }

  protected readonly gradeToneClass = gradeToneClass;

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.grade.list());
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('grades.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
