import { Component, computed, input, output, signal } from '@angular/core';

import { fromIsoDate, monthRangeOf, toIsoDate } from '../../core/date-range';
import { RangeFilter, SeriesOfProduct } from '../../models';
import { PrimengComponentsModule } from '../primeng-components-module';

type Preset = 'today' | 'thisMonth' | 'lastMonth';

/**
 * The period + series picker shared by the waste log, the month sheet and the
 * reports screen, so all three read the same window.
 */
@Component({
  selector: 'app-range-filter',
  imports: [PrimengComponentsModule],
  templateUrl: './range-filter.html',
  styleUrl: './range-filter.scss',
})
export class RangeFilterBar {
  readonly value = input.required<RangeFilter>();
  readonly series = input<SeriesOfProduct[]>([]);
  readonly busy = input(false);

  readonly changed = output<RangeFilter>();

  protected readonly fromDate = computed(() => fromIsoDate(this.value().from));
  protected readonly toDate = computed(() => fromIsoDate(this.value().to));

  protected readonly seriesOptions = computed(() => [
    { label: 'All series', value: null },
    ...this.series().map((item) => ({ label: item.name, value: item.id })),
  ]);

  protected readonly activePreset = signal<Preset | null>('thisMonth');

  protected setFrom(date: Date | null): void {
    if (!date) {
      return;
    }
    const from = toIsoDate(date);
    // Dragging the start past the end would ask the API for a backwards
    // range; pull the end along instead of erroring.
    const to = from > this.value().to ? from : this.value().to;
    this.emit({ from, to }, null);
  }

  protected setTo(date: Date | null): void {
    if (!date) {
      return;
    }
    const to = toIsoDate(date);
    const from = to < this.value().from ? to : this.value().from;
    this.emit({ from, to }, null);
  }

  protected setSeries(seriesId: number | null): void {
    this.changed.emit({ ...this.value(), seriesId });
  }

  protected applyPreset(preset: Preset): void {
    const today = new Date();

    switch (preset) {
      case 'today': {
        const day = toIsoDate(today);
        this.emit({ from: day, to: day }, preset);
        break;
      }
      case 'thisMonth':
        this.emit(monthRangeOf(today), preset);
        break;
      case 'lastMonth':
        this.emit(monthRangeOf(new Date(today.getFullYear(), today.getMonth() - 1, 1)), preset);
        break;
    }
  }

  protected isPreset(preset: Preset): boolean {
    return this.activePreset() === preset;
  }

  private emit(range: { from: string; to: string }, preset: Preset | null): void {
    this.activePreset.set(preset);
    this.changed.emit({ ...this.value(), ...range });
  }
}
