import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';

import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import { SeriesOfProduct } from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

@Component({
  selector: 'app-series',
  imports: [PrimengComponentsModule, FormsModule],
  templateUrl: './series.html',
  styleUrl: './series.scss',
})
export class Series {
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);

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
    this.load();
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

  protected save(): void {
    this.submitted.set(true);
    const name = this.name().trim();
    if (!name) {
      return;
    }

    this.saving.set(true);
    const editing = this.editing();
    const request = editing
      ? this.api.updateSeries(editing.id, { name })
      : this.api.createSeries({ name });

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogOpen.set(false);
        this.notify.success(editing ? `Renamed to "${name}".` : `Added "${name}".`);
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.notify.fromHttp(error, 'Could not save the series.');
      },
    });
  }

  protected remove(item: SeriesOfProduct): void {
    // The API refuses this too; catching it here explains why without a trip.
    if (item.workerCount > 0) {
      this.notify.warn(
        `"${item.name}" still has ${item.workerCount} worker(s) assigned. ` +
          'Move them to another series first.',
      );
      return;
    }

    this.confirm.confirm({
      header: 'Delete series',
      message: `Delete "${item.name}"? This cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () =>
        this.api.deleteSeries(item.id).subscribe({
          next: () => {
            this.notify.success(`Deleted "${item.name}".`);
            this.load();
          },
          error: (error) => this.notify.fromHttp(error, 'Could not delete the series.'),
        }),
    });
  }

  private load(): void {
    this.loading.set(true);
    this.api.listSeries().subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.notify.fromHttp(error, 'Could not load the product series.');
      },
    });
  }
}
