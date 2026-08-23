import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { currentMonthRange, formatRange } from '../../core/date-range';
import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import {
  Dashboard,
  DashboardRow,
  Grade,
  RangeFilter,
  Reason,
  SeriesOfProduct,
  workerFullName,
} from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { RangeFilterBar } from '../../shared/range-filter/range-filter';

/**
 * The shop-floor screen: pick the reason a piece was lost to, then tap grade 3
 * or grade 4 against the worker it belongs to.
 *
 * Taps apply to the local grid first and are rolled back if the API rejects
 * them, so a burst of entries never waits on the network.
 */
@Component({
  selector: 'app-waste',
  imports: [PrimengComponentsModule, FormsModule, RangeFilterBar],
  templateUrl: './waste.html',
  styleUrl: './waste.scss',
})
export class Waste {
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);

  protected readonly filter = signal<RangeFilter>(currentMonthRange());
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly activeReasonId = signal<number | null>(null);

  /** Cells with a request in flight, keyed `workerId:reasonId:grade`. */
  private readonly inFlight = signal<ReadonlySet<string>>(new Set());

  protected readonly reasons = computed(() => this.dashboard()?.reasons ?? []);

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

  /** Grade 3 / grade 4 tally for the reason currently on screen. */
  protected readonly reasonTally = computed(() => {
    const index = this.activeIndex();
    const totals = this.dashboard()?.reasonTotals ?? [];
    return index >= 0 && totals[index] ? totals[index] : { grade3: 0, grade4: 0 };
  });

  protected readonly grandTotal = computed(
    () => this.dashboard()?.grandTotal ?? { grade3: 0, grade4: 0 },
  );

  protected readonly rangeLabel = computed(() => formatRange(this.filter()));

  constructor() {
    this.api.listSeries().subscribe({
      next: (series) => this.series.set(series),
      error: (error) => this.notify.fromHttp(error, 'Could not load the product series.'),
    });
    this.load();
  }

  protected onFilterChange(filter: RangeFilter): void {
    this.filter.set(filter);
    this.load();
  }

  protected selectReason(reason: Reason): void {
    this.activeReasonId.set(reason.id);
  }

  protected countFor(row: DashboardRow, grade: Grade): number {
    const index = this.activeIndex();
    const cell = index >= 0 ? row.cells[index] : undefined;
    if (!cell) {
      return 0;
    }
    return grade === 3 ? cell.grade3 : cell.grade4;
  }

  protected rowTotalFor(row: DashboardRow): number {
    return this.countFor(row, 3) + this.countFor(row, 4);
  }

  protected isBusy(row: DashboardRow, grade: Grade): boolean {
    const reason = this.activeReason();
    return reason ? this.inFlight().has(key(row.worker.id, reason.id, grade)) : false;
  }

  protected trackRow = (_: number, row: DashboardRow) => row.worker.id;

  // ------------------------------------------------------------------------

  protected add(row: DashboardRow, grade: Grade): void {
    const reason = this.activeReason();
    if (!reason) {
      return;
    }

    const payload = { workerId: row.worker.id, reasonId: reason.id, grade };
    this.adjust(row.worker.id, reason.id, grade, +1);
    this.markInFlight(payload, true);

    this.api.addEntry(payload).subscribe({
      next: () => this.markInFlight(payload, false),
      error: (error) => {
        this.adjust(row.worker.id, reason.id, grade, -1);
        this.markInFlight(payload, false);
        this.notify.fromHttp(error, 'Could not record that entry.');
      },
    });
  }

  protected undo(row: DashboardRow, grade: Grade): void {
    const reason = this.activeReason();
    if (!reason || this.countFor(row, grade) <= 0) {
      return;
    }

    const payload = { workerId: row.worker.id, reasonId: reason.id, grade };
    this.adjust(row.worker.id, reason.id, grade, -1);
    this.markInFlight(payload, true);

    this.api.undoEntry(payload, this.filter()).subscribe({
      next: () => this.markInFlight(payload, false),
      error: (error) => {
        this.adjust(row.worker.id, reason.id, grade, +1);
        this.markInFlight(payload, false);
        this.notify.fromHttp(error, 'Could not remove that entry.');
      },
    });
  }

  protected reload(): void {
    this.load();
  }

  // ------------------------------------------------------------------------

  private load(): void {
    this.loading.set(true);

    this.api.dashboard(this.filter()).subscribe({
      next: (dashboard) => {
        this.dashboard.set(dashboard);
        this.loading.set(false);

        // Keep the operator on the same reason across a reload where we can.
        const stillThere = dashboard.reasons.some((reason) => reason.id === this.activeReasonId());
        if (!stillThere) {
          this.activeReasonId.set(dashboard.reasons[0]?.id ?? null);
        }
      },
      error: (error) => {
        this.loading.set(false);
        this.notify.fromHttp(error, 'Could not load the waste dashboard.');
      },
    });
  }

  /**
   * Applies `delta` to one cell and to every total that includes it, so the
   * summary strip stays honest without another round trip.
   */
  private adjust(workerId: number, reasonId: number, grade: Grade, delta: number): void {
    this.dashboard.update((current) => {
      if (!current) {
        return current;
      }

      const index = current.reasons.findIndex((reason) => reason.id === reasonId);
      if (index < 0) {
        return current;
      }

      const field = grade === 3 ? 'grade3' : 'grade4';

      const rows = current.rows.map((row) => {
        if (row.worker.id !== workerId) {
          return row;
        }
        const cells = row.cells.map((cell, cellIndex) =>
          cellIndex === index ? { ...cell, [field]: cell[field] + delta } : cell,
        );
        return { ...row, cells, total: { ...row.total, [field]: row.total[field] + delta } };
      });

      const reasonTotals = current.reasonTotals.map((total, totalIndex) =>
        totalIndex === index ? { ...total, [field]: total[field] + delta } : total,
      );

      return {
        ...current,
        rows,
        reasonTotals,
        grandTotal: { ...current.grandTotal, [field]: current.grandTotal[field] + delta },
      };
    });
  }

  private markInFlight(
    payload: { workerId: number; reasonId: number; grade: Grade },
    busy: boolean,
  ): void {
    this.inFlight.update((current) => {
      const next = new Set(current);
      const id = key(payload.workerId, payload.reasonId, payload.grade);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected readonly workerFullName = workerFullName;
}

function key(workerId: number, reasonId: number, grade: Grade): string {
  return `${workerId}:${reasonId}:${grade}`;
}
