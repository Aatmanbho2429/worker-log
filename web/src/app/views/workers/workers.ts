import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';

import { DataChangesService } from '../../core/data-changes.service';
import { NotifyService } from '../../core/notify.service';
import { SeriesService } from '../../services/series/series.service';
import { WorkerService } from '../../services/worker/worker.service';
import { SeriesOfProduct, Worker, WorkerPayload, workerFullName } from '../../models';
import { affects } from '../../models/events';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  seriesOfProductId: number | null;
}

const EMPTY_FORM: FormState = { firstName: '', lastName: '', phone: '', seriesOfProductId: null };

@Component({
  selector: 'app-workers',
  imports: [PrimengComponentsModule, FormsModule],
  templateUrl: './workers.html',
  styleUrl: './workers.scss',
})
export class Workers {
  private readonly worker = inject(WorkerService);
  private readonly seriesApi = inject(SeriesService);
  private readonly dataChanges = inject(DataChangesService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  protected readonly items = signal<Worker[]>([]);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly search = signal('');
  protected readonly seriesFilter = signal<number | null>(null);

  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Worker | null>(null);
  protected readonly form = signal<FormState>({ ...EMPTY_FORM });
  protected readonly submitted = signal(false);

  protected readonly seriesOptions = computed(() =>
    this.series().map((item) => ({ label: item.name, value: item.id })),
  );

  protected readonly seriesFilterOptions = computed(() => [
    { label: this.translate.instant('rangeFilter.allSeries'), value: null },
    ...this.seriesOptions(),
  ]);

  protected readonly filtered = computed(() => {
    const term = this.search().trim().toLowerCase();
    const seriesId = this.seriesFilter();

    return this.items().filter((worker) => {
      if (seriesId && worker.seriesOfProductId !== seriesId) {
        return false;
      }
      if (!term) {
        return true;
      }
      const haystack = `${workerFullName(worker)} ${worker.phone ?? ''} ${worker.seriesName}`;
      return haystack.toLowerCase().includes(term);
    });
  });

  protected readonly firstNameInvalid = computed(
    () => this.submitted() && !this.form().firstName.trim(),
  );
  protected readonly lastNameInvalid = computed(
    () => this.submitted() && !this.form().lastName.trim(),
  );
  protected readonly seriesInvalid = computed(
    () => this.submitted() && !this.form().seriesOfProductId,
  );

  constructor() {
    void this.load();

    this.dataChanges.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'workers', 'series')) {
        void this.load();
      }
    });
  }

  protected openNew(): void {
    if (!this.series().length) {
      this.notify.warn(this.translate.instant('workers.needSeriesWarning'));
      return;
    }
    this.editing.set(null);
    this.form.set({ ...EMPTY_FORM, seriesOfProductId: this.series()[0]?.id ?? null });
    this.submitted.set(false);
    this.dialogOpen.set(true);
  }

  protected openEdit(worker: Worker): void {
    this.editing.set(worker);
    this.form.set({
      firstName: worker.firstName,
      lastName: worker.lastName,
      phone: worker.phone ?? '',
      seriesOfProductId: worker.seriesOfProductId,
    });
    this.submitted.set(false);
    this.dialogOpen.set(true);
  }

  protected patch<K extends keyof FormState>(field: K, value: FormState[K]): void {
    this.form.update((current) => ({ ...current, [field]: value }));
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const form = this.form();

    if (!form.firstName.trim() || !form.lastName.trim() || !form.seriesOfProductId) {
      return;
    }

    const payload: WorkerPayload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim() || null,
      seriesOfProductId: form.seriesOfProductId,
    };

    this.saving.set(true);
    const editing = this.editing();

    try {
      const worker = editing
        ? await this.worker.update(editing.id, payload)
        : await this.worker.create(payload);

      this.notify.success(
        this.translate.instant(editing ? 'workers.updatedSuccess' : 'workers.addedSuccess', {
          name: workerFullName(worker),
        }),
      );
      this.dialogOpen.set(false);
      await this.load();
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('workers.saveFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Deleting a worker takes their waste entries with them, so the count is
   * fetched first and spelled out in the confirmation.
   */
  protected async remove(worker: Worker): Promise<void> {
    let loggedEntries: number;
    try {
      ({ loggedEntries } = await this.worker.deleteImpact(worker.id));
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('workers.impactFailed'));
      return;
    }

    const name = workerFullName(worker);
    const warning = loggedEntries
      ? this.translate.instant(
          loggedEntries === 1 ? 'workers.entrySingular' : 'workers.entryPlural',
          { count: loggedEntries },
        )
      : '';

    this.confirm.confirm({
      header: this.translate.instant('workers.deleteHeader'),
      message: this.translate.instant('workers.deleteMessage', { name, warning }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('common.delete'),
      rejectLabel: this.translate.instant('common.cancel'),
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: async () => {
        try {
          await this.worker.delete(worker.id);
          this.notify.success(this.translate.instant('workers.deletedSuccess', { name }));
          await this.load();
        } catch (error) {
          this.notify.fromCommand(error, this.translate.instant('workers.deleteFailed'));
        }
      },
    });
  }

  protected readonly workerFullName = workerFullName;

  private async load(): Promise<void> {
    this.loading.set(true);

    const [series, workers] = await Promise.allSettled([
      this.seriesApi.list(),
      this.worker.list(),
    ]);

    if (series.status === 'fulfilled') {
      this.series.set(series.value);
    } else {
      this.notify.fromCommand(series.reason, this.translate.instant('waste.seriesFailed'));
    }

    if (workers.status === 'fulfilled') {
      this.items.set(workers.value);
    } else {
      this.notify.fromCommand(workers.reason, this.translate.instant('workers.loadFailed'));
    }

    this.loading.set(false);
  }
}
