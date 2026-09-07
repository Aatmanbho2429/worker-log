import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';

import { currentMonthRange, formatRange } from '../../core/date-range';
import { ExportFormat, ExportService } from '../../services/export/export.service';
import { DataChangesService } from '../../core/data-changes.service';
import { NotifyService } from '../../core/notify.service';
import { SeriesService } from '../../services/series/series.service';
import { WasteService } from '../../services/waste/waste.service';
import {
  Dashboard,
  Grade,
  RangeFilter,
  SeriesOfProduct,
  sumCounts,
  workerFullName,
} from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { RangeFilterBar } from '../../shared/range-filter/range-filter';
import { ScanField } from '../../shared/scan-field/scan-field';

/**
 * The paper register on screen: workers down, a group of grade columns per
 * reason across, totals on every edge. Read-only — this is the sheet that gets
 * checked before it is exported.
 */
@Component({
  selector: 'app-sheet',
  imports: [PrimengComponentsModule, RangeFilterBar, ScanField],
  templateUrl: './sheet.html',
  styleUrl: './sheet.scss',
})
export class Sheet {
  private readonly waste = inject(WasteService);
  private readonly seriesApi = inject(SeriesService);
  private readonly dataChanges = inject(DataChangesService);
  private readonly exporter = inject(ExportService);
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  protected readonly filter = signal<RangeFilter>(currentMonthRange());
  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);

  protected readonly reasons = computed(() => this.dashboard()?.reasons ?? []);
  protected readonly rows = computed(() => this.dashboard()?.rows ?? []);
  protected readonly rangeLabel = computed(() => formatRange(this.filter()));

  /** The sub-columns inside every reason's group, and inside Total. */
  protected readonly grades = computed<Grade[]>(() => this.dashboard()?.grades ?? []);

  protected readonly hasData = computed(() => this.rows().some((row) => sumCounts(row.total) > 0));

  constructor() {
    void this.loadSeries();
    void this.load();

    // A read-only mirror, so anything that moves the register moves this.
    this.dataChanges.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
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

  /**
   * The narrow heading over one grade's column.
   *
   * The column is a few characters wide, which "Grade 3" is not — and the
   * paper register this mirrors rules those columns `3rd` and `4th`, so a name
   * ending in a number is written the same way. The PDF abbreviates
   * identically; the full names are in the group heading's tooltip.
   */
  protected shortGrade(grade: Grade, position: number): string {
    const trailing = /(\d+)\s*$/.exec(grade.name)?.[1];
    if (trailing) {
      const number = Number(trailing);
      const suffix =
        number % 100 >= 11 && number % 100 <= 13
          ? 'th'
          : ({ 1: 'st', 2: 'nd', 3: 'rd' }[number % 10] ?? 'th');
      return `${number}${suffix}`;
    }
    return grade.name.trim().slice(0, 4).toUpperCase() || `G${position + 1}`;
  }

  protected readonly workerFullName = workerFullName;

  private async loadSeries(): Promise<void> {
    try {
      this.series.set(await this.seriesApi.list());
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('waste.seriesFailed'));
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.dashboard.set(await this.waste.dashboard(this.filter()));
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('sheet.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }
}
