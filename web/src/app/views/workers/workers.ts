import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';

import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
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
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

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
    { label: 'All series', value: null },
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

    this.api.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'workers', 'series')) {
        void this.load();
      }
    });
  }

  protected openNew(): void {
    if (!this.series().length) {
      this.notify.warn('Add a series of product first — every worker belongs to one.');
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
        ? await this.api.updateWorker(editing.id, payload)
        : await this.api.createWorker(payload);

      this.notify.success(
        editing ? `Updated ${workerFullName(worker)}.` : `Added ${workerFullName(worker)}.`,
      );
      this.dialogOpen.set(false);
      await this.load();
    } catch (error) {
      this.notify.fromCommand(error, 'Could not save the worker.');
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
      ({ loggedEntries } = await this.api.workerDeleteImpact(worker.id));
    } catch (error) {
      this.notify.fromCommand(error, 'Could not check the worker before deleting.');
      return;
    }

    const name = workerFullName(worker);
    const warning = loggedEntries
      ? ` This also deletes ${loggedEntries} logged waste ` +
        `entr${loggedEntries === 1 ? 'y' : 'ies'}, which will change past reports.`
      : '';

    this.confirm.confirm({
      header: 'Delete worker',
      message: `Delete ${name}?${warning} This cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: async () => {
        try {
          await this.api.deleteWorker(worker.id);
          this.notify.success(`Deleted ${name}.`);
          await this.load();
        } catch (error) {
          this.notify.fromCommand(error, 'Could not delete the worker.');
        }
      },
    });
  }

  protected readonly workerFullName = workerFullName;

  private async load(): Promise<void> {
    this.loading.set(true);

    const [series, workers] = await Promise.allSettled([
      this.api.listSeries(),
      this.api.listWorkers(),
    ]);

    if (series.status === 'fulfilled') {
      this.series.set(series.value);
    } else {
      this.notify.fromCommand(series.reason, 'Could not load the product series.');
    }

    if (workers.status === 'fulfilled') {
      this.items.set(workers.value);
    } else {
      this.notify.fromCommand(workers.reason, 'Could not load the workers.');
    }

    this.loading.set(false);
  }
}
