import { RangeFilter } from '../models';

/** The API speaks `YYYY-MM-DD` in the factory's own local calendar. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** First to last day of the month containing `today` — the reporting period. */
export function currentMonthRange(today = new Date()): RangeFilter {
  return {
    from: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: toIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    seriesId: null,
  };
}

export function monthRangeOf(date: Date): { from: string; to: string } {
  return {
    from: toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1)),
    to: toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

export function formatRange(filter: { from: string; to: string }): string {
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  const from = fromIsoDate(filter.from).toLocaleDateString('en-GB', options);
  const to = fromIsoDate(filter.to).toLocaleDateString('en-GB', options);
  return from === to ? from : `${from} – ${to}`;
}
