import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';

import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import { Reason } from '../../models';
import { affects } from '../../models/events';
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
  private readonly destroyRef = inject(DestroyRef);

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
    void this.load();

    this.api.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'reasons')) {
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

  protected openEdit(reason: Reason): void {
    this.editing.set(reason);
    this.name.set(reason.name);
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
        await this.api.updateReason(editing.id, { name, sortOrder: editing.sortOrder });
        this.notify.success(`Renamed to "${name}".`);
      } else {
        await this.api.createReason({ name });
        this.notify.success(`Added "${name}".`);
      }
      this.dialogOpen.set(false);
      await this.load();
    } catch (error) {
      this.notify.fromCommand(error, 'Could not save the reason.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Swaps a reason with its neighbour, moving its column on the sheet. */
  protected async move(index: number, direction: -1 | 1): Promise<void> {
    const items = this.items();
    const target = index + direction;
    if (target < 0 || target >= items.length || this.reordering()) {
      return;
    }

    const a = items[index];
    const b = items[target];
    this.reordering.set(true);

    try {
      // Sequential, not parallel: both writes touch the same table through one
      // guarded connection, and a failed second write should leave the first
      // one visible rather than racing it.
      await this.api.updateReason(a.id, { name: a.name, sortOrder: b.sortOrder });
      await this.api.updateReason(b.id, { name: b.name, sortOrder: a.sortOrder });
    } catch (error) {
      this.notify.fromCommand(error, 'Could not reorder the reasons.');
    } finally {
      this.reordering.set(false);
      await this.load();
    }
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
      accept: async () => {
        try {
          await this.api.deleteReason(reason.id);
          this.notify.success(`Deleted "${reason.name}".`);
          await this.load();
        } catch (error) {
          this.notify.fromCommand(error, 'Could not delete the reason.');
        }
      },
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.api.listReasons());
    } catch (error) {
      this.notify.fromCommand(error, 'Could not load the reasons.');
    } finally {
      this.loading.set(false);
    }
  }
}
