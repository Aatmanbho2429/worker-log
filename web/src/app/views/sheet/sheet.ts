import { Component, computed, inject, signal } from '@angular/core';

import { currentMonthRange, formatRange } from '../../core/date-range';
import { NotifyService } from '../../core/notify.service';
import { WasteLogService } from '../../core/waste-log.service';
import { Dashboard, RangeFilter, SeriesOfProduct, workerFullName } from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { RangeFilterBar } from '../../shared/range-filter/range-filter';

/**
 * The paper register on screen: workers down, a 3rd/4th pair per reason
 * across, totals on every edge. Read-only — this is the sheet that gets
 * checked before it is exported.
 */
@Component({
  selector: 'app-sheet',
  imports: [PrimengComponentsModule, RangeFilterBar],
  templateUrl: './sheet.html',
  styleUrl: './sheet.scss',
})
export class Sheet {
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);

  protected readonly filter = signal<RangeFilter>(currentMonthRange());
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);

  protected readonly reasons = computed(() => this.dashboard()?.reasons ?? []);
  protected readonly rows = computed(() => this.dashboard()?.rows ?? []);
  protected readonly rangeLabel = computed(() => formatRange(this.filter()));

  protected readonly hasData = computed(() =>
    this.rows().some((row) => row.total.grade3 + row.total.grade4 > 0),
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
    window.open(this.api.reportUrl(this.filter(), format), '_blank');
  }

  /** Blank rather than `0`, the way an unused box on the paper sheet is. */
  protected box(value: number): string {
    return value === 0 ? '' : `${value}`;
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
        this.notify.fromHttp(error, 'Could not load the month sheet.');
      },
    });
  }
}
