import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { currentMonthRange, formatRange } from '../../core/date-range';
import { ExportFormat, ExportService } from '../../core/export.service';
import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import { Dashboard, RangeFilter, SeriesOfProduct, WorkerLog, workerFullName } from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { RangeFilterBar } from '../../shared/range-filter/range-filter';

interface ReasonBreakdown {
  name: string;
  grade3: number;
  grade4: number;
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

  protected readonly grandTotal = computed(
    () => this.dashboard()?.grandTotal ?? { grade3: 0, grade4: 0 },
  );

  protected readonly totalPieces = computed(
    () => this.grandTotal().grade3 + this.grandTotal().grade4,
  );

  protected readonly workersWithWaste = computed(
    () =>
      (this.dashboard()?.rows ?? []).filter((row) => row.total.grade3 + row.total.grade4 > 0)
        .length,
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
        const cell = dashboard.reasonTotals[index] ?? { grade3: 0, grade4: 0 };
        const total = cell.grade3 + cell.grade4;
        return {
          name: reason.name,
          grade3: cell.grade3,
          grade4: cell.grade4,
          total,
          share: overall ? Math.round((total / overall) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  });

  protected readonly topWorkers = computed(() =>
    [...(this.dashboard()?.rows ?? [])]
      .filter((row) => row.total.grade3 + row.total.grade4 > 0)
      .sort((a, b) => b.total.grade3 + b.total.grade4 - (a.total.grade3 + a.total.grade4))
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

  protected rowTotal(row: { total: { grade3: number; grade4: number } }): number {
    return row.total.grade3 + row.total.grade4;
  }

  protected readonly workerFullName = workerFullName;

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
