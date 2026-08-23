import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { forkJoin } from 'rxjs';

import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import { Reason } from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

/**
 * The reason columns of the sheet. Their order here is the order the columns
 * run across the month sheet and the exported PDF, so it is editable.
 */
@Component({
  selector: 'app-reasons',
  imports: [PrimengComponentsModule, FormsModule],
  templateUrl: './reasons.html',
  styleUrl: './reasons.scss',
})
export class Reasons {
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);

  protected readonly items = signal<Reason[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly reordering = signal(false);

  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<Reason | null>(null);
  protected readonly name = signal('');
  protected readonly submitted = signal(false);

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

  protected openEdit(reason: Reason): void {
    this.editing.set(reason);
    this.name.set(reason.name);
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
      ? this.api.updateReason(editing.id, { name, sortOrder: editing.sortOrder })
      : this.api.createReason({ name });

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogOpen.set(false);
        this.notify.success(editing ? `Renamed to "${name}".` : `Added "${name}".`);
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.notify.fromHttp(error, 'Could not save the reason.');
      },
    });
  }

  /** Swaps a reason with its neighbour, moving its column on the sheet. */
  protected move(index: number, direction: -1 | 1): void {
    const items = this.items();
    const target = index + direction;
    if (target < 0 || target >= items.length || this.reordering()) {
      return;
    }

    const a = items[index];
    const b = items[target];
    this.reordering.set(true);

    forkJoin([
      this.api.updateReason(a.id, { name: a.name, sortOrder: b.sortOrder }),
      this.api.updateReason(b.id, { name: b.name, sortOrder: a.sortOrder }),
    ]).subscribe({
      next: () => {
        this.reordering.set(false);
        this.load();
      },
      error: (error) => {
        this.reordering.set(false);
        this.notify.fromHttp(error, 'Could not reorder the reasons.');
        this.load();
      },
    });
  }

  protected remove(reason: Reason): void {
    this.confirm.confirm({
      header: 'Delete reason',
      message:
        `Delete "${reason.name}"? Its column disappears from the sheet. ` +
        'If waste has already been logged against it, rename it instead.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () =>
        this.api.deleteReason(reason.id).subscribe({
          next: () => {
            this.notify.success(`Deleted "${reason.name}".`);
            this.load();
          },
          error: (error) => this.notify.fromHttp(error, 'Could not delete the reason.'),
        }),
    });
  }

  private load(): void {
    this.loading.set(true);
    this.api.listReasons().subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.notify.fromHttp(error, 'Could not load the reasons.');
      },
    });
  }
}
