import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { currentMonthRange, formatRange } from '../../core/date-range';
import { gradeToneClass } from '../../core/grade-tone';
import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import {
  Dashboard,
  DashboardRow,
  Grade,
  RangeFilter,
  Reason,
  SeriesOfProduct,
  WorkerLog,
  sumCounts,
  workerFullName,
} from '../../models';
import { affects } from '../../models/events';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { RangeFilterBar } from '../../shared/range-filter/range-filter';
import { ScanField } from '../../shared/scan-field/scan-field';

/**
 * The shop-floor screen: pick the reason a piece was lost to, then tap the
 * grade it was sorted into against the worker it belongs to.
 *
 * Taps apply to the local grid first and are rolled back if the command
 * rejects them, so a burst of entries never waits on the backend.
 */
@Component({
  selector: 'app-waste',
  imports: [PrimengComponentsModule, FormsModule, RangeFilterBar, ScanField],
  templateUrl: './waste.html',
  styleUrl: './waste.scss',
})
export class Waste {
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filter = signal<RangeFilter>(currentMonthRange());
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly activeReasonId = signal<number | null>(null);

  /** Cells with a command in flight, keyed `workerId:reasonId:gradeId`. */
  private readonly inFlight = signal<ReadonlySet<string>>(new Set());

  protected readonly reasons = computed(() => this.dashboard()?.reasons ?? []);

  /** The grade columns, which are also the buttons in every worker's row. */
  protected readonly grades = computed<Grade[]>(() => this.dashboard()?.grades ?? []);

  protected readonly activeReason = computed<Reason | null>(() => {
    const id = this.activeReasonId();
    return this.reasons().find((reason) => reason.id === id) ?? this.reasons()[0] ?? null;
  });

  private readonly activeIndex = computed(() => {
    const reason = this.activeReason();
    return reason ? this.reasons().findIndex((item) => item.id === reason.id) : -1;
  });

  protected readonly rows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const rows = this.dashboard()?.rows ?? [];
    if (!term) {
      return rows;
    }
    return rows.filter((row) => {
      const haystack = `${workerFullName(row.worker)} ${row.worker.seriesName}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  /** Per-grade tally for the reason currently on screen. */
  protected readonly reasonTally = computed<number[]>(() => {
    const index = this.activeIndex();
    const totals = this.dashboard()?.reasonTotals ?? [];
    return (index >= 0 ? totals[index]?.counts : undefined) ?? this.grades().map(() => 0);
  });

  protected readonly grandTotal = computed<number[]>(
    () => this.dashboard()?.grandTotal ?? this.grades().map(() => 0),
  );

  /** `3 / 4 / 0`, so the summary strip reads the same however many grades. */
  protected readonly grandTotalLabel = computed(() => this.grandTotal().join(' / '));

  protected readonly rangeLabel = computed(() => formatRange(this.filter()));

  /** This reason's count for the grade at `index`. */
  protected tallyFor(index: number): number {
    return this.reasonTally()[index] ?? 0;
  }

  constructor() {
    void this.loadSeries();
    void this.load();

    // Reload when the master data behind the grid moves — a worker added, a
    // reason renamed, a grade created, demo data loaded. Deliberately *not* on
    // `waste`: this screen's own taps are the only source of those, its
    // optimistic state is already correct, and reloading mid-burst would fight
    // the operator.
    this.api.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'workers', 'series', 'reasons', 'grades')) {
        void this.loadSeries();
        void this.load();
      }
    });
  }

  protected onFilterChange(filter: RangeFilter): void {
    this.filter.set(filter);
    void this.load();
  }

  protected selectReason(reason: Reason): void {
    this.activeReasonId.set(reason.id);
  }

  /** The count in one cell, by the grade's position in the row. */
  protected countFor(row: DashboardRow, gradeIndex: number): number {
    const index = this.activeIndex();
    return (index >= 0 ? row.cells[index]?.counts[gradeIndex] : undefined) ?? 0;
  }

  protected rowTotalFor(row: DashboardRow): number {
    const index = this.activeIndex();
    return sumCounts((index >= 0 ? row.cells[index]?.counts : undefined) ?? []);
  }

  protected isBusy(row: DashboardRow, grade: Grade): boolean {
    const reason = this.activeReason();
    return reason ? this.inFlight().has(key(row.worker.id, reason.id, grade.id)) : false;
  }

  protected reasonCount(reasonIndex: number): string {
    const counts = this.dashboard()?.reasonTotals?.[reasonIndex]?.counts ?? [];
    return counts.length ? counts.join('/') : '0';
  }

  protected trackRow = (_: number, row: DashboardRow) => row.worker.id;

  // ------------------------------------------------------------------------

  protected async add(row: DashboardRow, gradeIndex: number): Promise<void> {
    const reason = this.activeReason();
    const grade = this.grades()[gradeIndex];
    if (!reason || !grade) {
      return;
    }

    const payload = { workerId: row.worker.id, reasonId: reason.id, gradeId: grade.id };
    this.adjust(row.worker.id, reason.id, gradeIndex, +1);
    this.markInFlight(payload, true);

    try {
      await this.api.addEntry(payload);
    } catch (error) {
      this.adjust(row.worker.id, reason.id, gradeIndex, -1);
      this.notify.fromCommand(error, 'Could not record that entry.');
    } finally {
      this.markInFlight(payload, false);
    }
  }

  protected async undo(row: DashboardRow, gradeIndex: number): Promise<void> {
    const reason = this.activeReason();
    const grade = this.grades()[gradeIndex];
    if (!reason || !grade || this.countFor(row, gradeIndex) <= 0) {
      return;
    }

    const payload = { workerId: row.worker.id, reasonId: reason.id, gradeId: grade.id };
    this.adjust(row.worker.id, reason.id, gradeIndex, -1);
    this.markInFlight(payload, true);

    try {
      await this.api.undoEntry(payload, this.filter());
    } catch (error) {
      this.adjust(row.worker.id, reason.id, gradeIndex, +1);
      this.notify.fromCommand(error, 'Could not remove that entry.');
    } finally {
      this.markInFlight(payload, false);
    }
  }

  protected reload(): void {
    void this.load();
  }

  /**
   * Folds a scanned entry into the grid.
   *
   * A scan is the same write a tap is, so it is applied the same way — locally,
   * against the cell it belongs to. The screen ignores its own `waste` events
   * for that reason, and a scan against a reason the operator is not looking at
   * still moves the totals.
   *
   * An entry can land outside what is on screen: a worker filtered out by the
   * series picker, or a range that does not include today. There is nothing to
   * adjust then, so the reload puts the register back in agreement rather than
   * leaving the confirmation pointing at a count that never moved.
   */
  protected onScanned(entry: WorkerLog): void {
    const gradeIndex = this.grades().findIndex((grade) => grade.id === entry.gradeId);
    const inView =
      gradeIndex >= 0 &&
      this.dashboard()?.reasons.some((reason) => reason.id === entry.reasonId) === true &&
      this.dashboard()?.rows.some((row) => row.worker.id === entry.workerId) === true;

    if (inView) {
      this.adjust(entry.workerId, entry.reasonId, gradeIndex, +1);
    } else {
      void this.load();
    }
  }

  // ------------------------------------------------------------------------

  private async loadSeries(): Promise<void> {
    try {
      this.series.set(await this.api.listSeries());
    } catch (error) {
      this.notify.fromCommand(error, 'Could not load the product series.');
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);

    try {
      const dashboard = await this.api.dashboard(this.filter());
      this.dashboard.set(dashboard);

      // Keep the operator on the same reason across a reload where we can.
      const stillThere = dashboard.reasons.some((reason) => reason.id === this.activeReasonId());
      if (!stillThere) {
        this.activeReasonId.set(dashboard.reasons[0]?.id ?? null);
      }
    } catch (error) {
      this.notify.fromCommand(error, 'Could not load the waste dashboard.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Applies `delta` to one cell and to every total that includes it, so the
   * summary strip stays honest without another round trip.
   *
   * `gradeIndex` is the grade's slot in every `counts` array, which is what
   * lines the number up with its column.
   */
  private adjust(workerId: number, reasonId: number, gradeIndex: number, delta: number): void {
    this.dashboard.update((current) => {
      if (!current) {
        return current;
      }

      const index = current.reasons.findIndex((reason) => reason.id === reasonId);
      if (index < 0) {
        return current;
      }

      const bump = (counts: number[]): number[] =>
        counts.map((count, slot) => (slot === gradeIndex ? count + delta : count));

      const rows = current.rows.map((row) => {
        if (row.worker.id !== workerId) {
          return row;
        }
        const cells = row.cells.map((cell, cellIndex) =>
          cellIndex === index ? { ...cell, counts: bump(cell.counts) } : cell,
        );
        return { ...row, cells, total: bump(row.total) };
      });

      const reasonTotals = current.reasonTotals.map((total, totalIndex) =>
        totalIndex === index ? { ...total, counts: bump(total.counts) } : total,
      );

      return { ...current, rows, reasonTotals, grandTotal: bump(current.grandTotal) };
    });
  }

  private markInFlight(
    payload: { workerId: number; reasonId: number; gradeId: number },
    busy: boolean,
  ): void {
    this.inFlight.update((current) => {
      const next = new Set(current);
      const id = key(payload.workerId, payload.reasonId, payload.gradeId);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected readonly workerFullName = workerFullName;
  protected readonly gradeToneClass = gradeToneClass;
}

function key(workerId: number, reasonId: number, gradeId: number): string {
  return `${workerId}:${reasonId}:${gradeId}`;
}
