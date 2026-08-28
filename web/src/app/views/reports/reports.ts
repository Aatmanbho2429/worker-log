import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { currentMonthRange, formatRange } from '../../core/date-range';
import { ExportFormat, ExportService } from '../../core/export.service';
import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import { gradeToneClass } from '../../core/grade-tone';
import {
  Dashboard,
  DashboardRow,
  Grade,
  RangeFilter,
  SeriesOfProduct,
  WorkerLog,
  sumCounts,
  workerFullName,
} from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { RangeFilterBar } from '../../shared/range-filter/range-filter';

interface ReasonBreakdown {
  name: string;
  /** One count per grade, in the same order as `Reports.grades`. */
  counts: number[];
  total: number;
  /** Share of all waste in the period, for the bar behind the row. */
  share: number;
}

/**
 * End-of-month view: check the totals, scan the audit trail, then export the
 * sheet as PDF for filing or CSV for the office spreadsheet.
 */
@Component({
  selector: 'app-reports',
  imports: [PrimengComponentsModule, RangeFilterBar],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports {
  private readonly api = inject(WasteLogService);
  private readonly exporter = inject(ExportService);
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filter = signal<RangeFilter>(currentMonthRange());
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly entries = signal<WorkerLog[]>([]);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);

  protected readonly rangeLabel = computed(() => formatRange(this.filter()));

  /** The grades the register tracks, which drive every split on this screen. */
  protected readonly grades = computed<Grade[]>(() => this.dashboard()?.grades ?? []);

  protected readonly grandTotal = computed<number[]>(
    () => this.dashboard()?.grandTotal ?? this.grades().map(() => 0),
  );

  protected readonly totalPieces = computed(() => sumCounts(this.grandTotal()));

  /** The period's total for the grade at `index`. */
  protected gradeTotal(index: number): number {
    return this.grandTotal()[index] ?? 0;
  }

  protected readonly workersWithWaste = computed(
    () => (this.dashboard()?.rows ?? []).filter((row) => sumCounts(row.total) > 0).length,
  );

  /** Reasons ranked by how much they cost, worst first. */
  protected readonly breakdown = computed<ReasonBreakdown[]>(() => {
    const dashboard = this.dashboard();
    if (!dashboard) {
      return [];
    }

    const overall = this.totalPieces();

    return dashboard.reasons
      .map((reason, index) => {
        const counts = dashboard.reasonTotals[index]?.counts ?? dashboard.grades.map(() => 0);
        const total = sumCounts(counts);
        return {
          name: reason.name,
          counts,
          total,
          share: overall ? Math.round((total / overall) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  });

  protected readonly topWorkers = computed(() =>
    [...(this.dashboard()?.rows ?? [])]
      .filter((row) => sumCounts(row.total) > 0)
      .sort((a, b) => sumCounts(b.total) - sumCounts(a.total))
      .slice(0, 8),
  );

  constructor() {
    void this.loadSeries();
    void this.load();

    this.api.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.loadSeries();
      void this.load();
    });
  }

  protected onFilterChange(filter: RangeFilter): void {
    this.filter.set(filter);
    void this.load();
  }

  protected async download(format: ExportFormat): Promise<void> {
    if (!this.dashboard()?.rows.length) {
      this.notify.warn('There is nothing to export for this period.');
      return;
    }

    this.exporting.set(true);
    try {
      await this.exporter.export(this.filter(), format);
    } finally {
      this.exporting.set(false);
    }
  }

  protected rowTotal(row: DashboardRow): number {
    return sumCounts(row.total);
  }

  /**
   * A grade's position in the register, which is what its colour is keyed to.
   *
   * The entry history lists individual entries rather than the grid, so it has
   * an id to place rather than a column index. A grade deleted since the entry
   * was logged is not in the list any more, and falls back to the first tone.
   */
  protected gradeIndex(gradeId: number): number {
    return Math.max(
      0,
      this.grades().findIndex((grade) => grade.id === gradeId),
    );
  }

  protected readonly workerFullName = workerFullName;
  protected readonly gradeToneClass = gradeToneClass;

  private async loadSeries(): Promise<void> {
    try {
      this.series.set(await this.api.listSeries());
    } catch (error) {
      this.notify.fromCommand(error, 'Could not load the product series.');
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);

    const [dashboard, entries] = await Promise.allSettled([
      this.api.dashboard(this.filter()),
      this.api.logs(this.filter()),
    ]);

    if (dashboard.status === 'fulfilled') {
      this.dashboard.set(dashboard.value);
    } else {
      this.notify.fromCommand(dashboard.reason, 'Could not load the report.');
    }

    if (entries.status === 'fulfilled') {
      this.entries.set(entries.value);
    } else {
      this.notify.fromCommand(entries.reason, 'Could not load the entry history.');
    }

    this.loading.set(false);
  }
}
