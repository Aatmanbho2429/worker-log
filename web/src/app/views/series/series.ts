import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';

import { DataChangesService } from '../../core/data-changes.service';
import { NotifyService } from '../../core/notify.service';
import { SeriesService } from '../../services/series/series.service';
import { SeriesOfProduct } from '../../models';
import { affects } from '../../models/events';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

@Component({
  selector: 'app-series',
  imports: [PrimengComponentsModule, FormsModule],
  templateUrl: './series.html',
  styleUrl: './series.scss',
})
export class Series {
  private readonly series = inject(SeriesService);
  private readonly dataChanges = inject(DataChangesService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  protected readonly items = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly search = signal('');

  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<SeriesOfProduct | null>(null);
  protected readonly name = signal('');
  protected readonly submitted = signal(false);

  protected readonly filtered = computed(() => {
    const term = this.search().trim().toLowerCase();
    return term
      ? this.items().filter((item) => item.name.toLowerCase().includes(term))
      : this.items();
  });

  protected readonly nameInvalid = computed(() => this.submitted() && !this.name().trim());

  constructor() {
    void this.load();

    // The worker count per series moves when workers change, not just series.
    this.dataChanges.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'series', 'workers')) {
        void this.load();
      }
    });
  }

  protected openNew(): void {
    this.editing.set(null);
    this.name.set('');
    this.submitted.set(false);
    this.dialogOpen.set(true);
  }

  protected openEdit(item: SeriesOfProduct): void {
    this.editing.set(item);
    this.name.set(item.name);
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
        await this.series.update(editing.id, { name });
        this.notify.success(this.translate.instant('common.renamedSuccess', { name }));
      } else {
        await this.series.create({ name });
        this.notify.success(this.translate.instant('common.addedSuccess', { name }));
      }
      this.dialogOpen.set(false);
      await this.load();
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('series.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected remove(item: SeriesOfProduct): void {
    // The backend refuses this too; catching it here explains why without a
    // round trip that would only come back as an error toast.
    if (item.workerCount > 0) {
      this.notify.warn(
        this.translate.instant('series.inUseWarning', {
          name: item.name,
          count: item.workerCount,
        }),
      );
      return;
    }

    this.confirm.confirm({
      header: this.translate.instant('series.deleteHeader'),
      message: this.translate.instant('series.deleteMessage', { name: item.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('common.delete'),
      rejectLabel: this.translate.instant('common.cancel'),
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: async () => {
        try {
          await this.series.delete(item.id);
          this.notify.success(this.translate.instant('common.deletedSuccess', { name: item.name }));
          await this.load();
        } catch (error) {
          this.notify.fromCommand(error, this.translate.instant('series.deleteFailed'));
        }
      },
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.series.list());
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('waste.seriesFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
