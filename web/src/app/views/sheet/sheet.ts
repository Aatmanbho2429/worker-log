import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { currentMonthRange, formatRange } from '../../core/date-range';
import { ExportFormat, ExportService } from '../../core/export.service';
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
  private readonly exporter = inject(ExportService);
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filter = signal<RangeFilter>(currentMonthRange());
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);

  protected readonly reasons = computed(() => this.dashboard()?.reasons ?? []);
  protected readonly rows = computed(() => this.dashboard()?.rows ?? []);
  protected readonly rangeLabel = computed(() => formatRange(this.filter()));

  protected readonly hasData = computed(() =>
    this.rows().some((row) => row.total.grade3 + row.total.grade4 > 0),
  );

  constructor() {
    void this.loadSeries();
    void this.load();

    // A read-only mirror, so anything that moves the register moves this.
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
    this.exporting.set(true);
    try {
      await this.exporter.export(this.filter(), format);
    } finally {
      this.exporting.set(false);
    }
  }

  /** Blank rather than `0`, the way an unused box on the paper sheet is. */
  protected box(value: number): string {
    return value === 0 ? '' : `${value}`;
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
    try {
      this.dashboard.set(await this.api.dashboard(this.filter()));
    } catch (error) {
      this.notify.fromCommand(error, 'Could not load the month sheet.');
    } finally {
      this.loading.set(false);
    }
  }
}
