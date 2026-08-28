import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';

import { gradeToneClass } from '../../core/grade-tone';
import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
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
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

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
    this.api.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
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
        await this.api.updateGrade(editing.id, { name });
        this.notify.success(`Renamed to "${name}".`);
      } else {
        await this.api.createGrade({ name });
        this.notify.success(`Added "${name}". Print a fresh scanning sheet to get its barcodes.`);
      }
      this.dialogOpen.set(false);
      await this.load();
    } catch (error) {
      this.notify.fromCommand(error, 'Could not save the grade.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(grade: Grade): Promise<void> {
    // The backend refuses both of these too; catching them here explains why
    // without a round trip that would only come back as an error toast.
    if (grade.entryCount > 0) {
      this.notify.warn(
        `"${grade.name}" is used by ${grade.entryCount} waste entr(ies) and cannot be deleted. ` +
          'Rename it instead so past sheets stay accurate.',
      );
      return;
    }
    if (this.items().length <= 1) {
      this.notify.warn('The register needs at least one grade to log waste against.');
      return;
    }

    let barcodes = 0;
    try {
      barcodes = (await this.api.gradeDeleteImpact(grade.id)).barcodes;
    } catch (error) {
      this.notify.fromCommand(error, 'Could not check what deleting this grade would affect.');
      return;
    }

    const printed = barcodes
      ? ` ${barcodes} printed barcode(s) will stop working — print a fresh scanning sheet afterwards.`
      : '';

    this.confirm.confirm({
      header: 'Delete grade',
      message: `Delete "${grade.name}"? Its button leaves every worker's row.${printed}`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: async () => {
        try {
          await this.api.deleteGrade(grade.id);
          this.notify.success(`Deleted "${grade.name}".`);
          await this.load();
        } catch (error) {
          this.notify.fromCommand(error, 'Could not delete the grade.');
        }
      },
    });
  }

  protected readonly gradeToneClass = gradeToneClass;

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.api.listGrades());
    } catch (error) {
      this.notify.fromCommand(error, 'Could not load the grades.');
    } finally {
      this.loading.set(false);
    }
  }
}
