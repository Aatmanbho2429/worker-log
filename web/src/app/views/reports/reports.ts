import { Component, computed, inject, signal } from '@angular/core';

import { currentMonthRange, formatRange } from '../../core/date-range';
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
  private readonly notify = inject(NotifyService);

  protected readonly filter = signal<RangeFilter>(currentMonthRange());
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly entries = signal<WorkerLog[]>([]);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);

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

  protected download(format: 'pdf' | 'csv'): void {
    if (!this.dashboard()?.rows.length) {
      this.notify.warn('There is nothing to export for this period.');
      return;
    }
    window.open(this.api.reportUrl(this.filter(), format), '_blank');
  }

  protected rowTotal(row: { total: { grade3: number; grade4: number } }): number {
    return row.total.grade3 + row.total.grade4;
  }

  protected readonly workerFullName = workerFullName;

  private load(): void {
    this.loading.set(true);

    this.api.dashboard(this.filter()).subscribe({
      next: (dashboard) => {
        this.dashboard.set(dashboard);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.notify.fromHttp(error, 'Could not load the report.');
      },
    });

    this.api.logs(this.filter()).subscribe({
      next: (entries) => this.entries.set(entries),
      error: (error) => this.notify.fromHttp(error, 'Could not load the entry history.'),
    });
  }
}
