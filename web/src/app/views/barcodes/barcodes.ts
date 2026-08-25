import { Component, DestroyRef, NgZone, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';

import { NotifyService } from '../../core/notify.service';
import { ScanService } from '../../core/scan.service';
import { WasteLogService } from '../../core/waste-log.service';
import { BarcodeSheet, BarcodeSymbol, Grade, SeriesOfProduct } from '../../models';
import { affects } from '../../models/events';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';

/** An entry the reader just recorded, kept briefly so the operator sees it. */
interface Recorded {
  worker: string;
  reason: string;
  grade: Grade;
  at: string;
}

/**
 * One barcode, with its bars already reduced to a single SVG path.
 *
 * The whole sheet is 480 barcodes. Drawing each bar as its own `<rect>` would
 * put some fifteen thousand elements on the page and rebuild them all on every
 * change detection pass; one path per barcode is two orders of magnitude less
 * DOM and is computed once, when the sheet loads.
 */
interface Tile {
  code: string;
  grade: Grade;
  path: string;
}

interface RowView {
  workerId: number;
  name: string;
  seriesName: string;
  tiles: Tile[];
}

interface ReasonView {
  reasonId: number;
  reasonName: string;
  rows: RowView[];
}

/**
 * The scanning station: the waste screen with barcodes where the buttons are.
 *
 * Each barcode *is* a grade button — it carries the worker, the reason and the
 * grade — so one scan records one entry, exactly as one tap does. The buttons
 * on the waste screen are unchanged; this is the same action taken with a
 * reader instead of a finger.
 *
 * Every reason is on this one page. There is nothing to pick and nothing to
 * navigate: the operator finds the barcode they want and scans it, which is
 * what they would be doing with a printed sheet on the wall anyway.
 */
@Component({
  selector: 'app-barcodes',
  imports: [PrimengComponentsModule, FormsModule],
  templateUrl: './barcodes.html',
  styleUrl: './barcodes.scss',
})
export class Barcodes {
  private readonly api = inject(WasteLogService);
  private readonly notify = inject(NotifyService);
  private readonly scanner = inject(ScanService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  protected readonly sheet = signal<BarcodeSheet | null>(null);
  protected readonly series = signal<SeriesOfProduct[]>([]);
  protected readonly seriesId = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly search = signal('');

  /** The last few entries the reader recorded, newest first. */
  protected readonly recent = signal<Recorded[]>([]);
  protected readonly problem = signal<string | null>(null);

  /**
   * Scans counted since this screen was opened, keyed
   * `workerId:reasonId:grade`.
   *
   * Keyed by reason as well as worker because every reason lists every worker:
   * a scan against Karigar must not light up the same worker's badge under
   * Handling.
   *
   * Deliberately a session tally rather than the register's totals: the
   * operator wants to see that the beep landed, and a running count they can
   * check against the pieces in front of them is more use for that than a
   * month-to-date figure.
   */
  private readonly tally = signal<ReadonlyMap<string, number>>(new Map());

  /** The whole sheet, with every barcode's geometry worked out once. */
  private readonly view = computed<ReasonView[]>(() =>
    (this.sheet()?.reasons ?? []).map((reason) => ({
      reasonId: reason.reasonId,
      reasonName: reason.reasonName,
      rows: reason.rows.map((row) => ({
        workerId: row.workerId,
        name: row.name,
        seriesName: row.seriesName,
        tiles: [
          { code: row.grade3.code, grade: 3 as Grade, path: barsPath(row.grade3) },
          { code: row.grade4.code, grade: 4 as Grade, path: barsPath(row.grade4) },
        ],
      })),
    })),
  );

  /**
   * The sheet with the worker filter applied. A reason whose workers are all
   * filtered out drops away, so a search never leaves a run of empty headings
   * between the rows that matched.
   */
  protected readonly reasons = computed<ReasonView[]>(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.view();
    }
    return this.view()
      .map((reason) => ({
        ...reason,
        rows: reason.rows.filter((row) =>
          `${row.name} ${row.seriesName}`.toLowerCase().includes(term),
        ),
      }))
      .filter((reason) => reason.rows.length > 0);
  });

  protected readonly barcodeCount = computed(() =>
    this.reasons().reduce((total, reason) => total + reason.rows.length * 2, 0),
  );

  protected readonly scannedTotal = computed(() =>
    [...this.tally().values()].reduce((sum, count) => sum + count, 0),
  );

  constructor() {
    void this.load();

    this.scanner
      .listen(this.destroyRef)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => void this.onScan(code));

    // A worker added or a reason renamed changes what belongs on the sheet.
    // Waste taps do not: they change counts, and the sheet shows no totals.
    this.api.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'workers', 'reasons', 'series')) {
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [sheet, series] = await Promise.all([
        this.api.barcodeSheet(this.seriesId()),
        this.api.listSeries(),
      ]);
      this.sheet.set(sheet);
      this.series.set(series);
    } catch (error) {
      this.notify.fromCommand(error, 'Could not build the scanning sheet.');
    } finally {
      this.loading.set(false);
    }
  }

  protected onSeriesChange(id: number | null): void {
    this.seriesId.set(id);
    void this.load();
  }

  /** Scrolls a reason into view. Nothing is hidden; this only saves scrolling. */
  protected jumpTo(reasonId: number): void {
    document
      .getElementById(`reason-${reasonId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** One scan, one entry. The barcode names its own worker, reason and grade. */
  private async onScan(code: string): Promise<void> {
    try {
      const receipt = await this.api.recordScan(code);

      this.problem.set(null);
      this.bump(receipt.entry.workerId, receipt.entry.reasonId, receipt.grade);
      this.recent.update((entries) =>
        [
          {
            worker: receipt.workerName,
            reason: receipt.reasonName,
            grade: receipt.grade,
            at: new Date().toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          },
          ...entries,
        ].slice(0, 8),
      );
    } catch (error) {
      this.problem.set(messageOf(error, 'That barcode could not be recorded.'));
    }
  }

  private bump(workerId: number, reasonId: number, grade: Grade): void {
    this.tally.update((counts) => {
      const next = new Map(counts);
      const key = tallyKey(workerId, reasonId, grade);
      next.set(key, (next.get(key) ?? 0) + 1);
      return next;
    });
  }

  protected scanned(workerId: number, reasonId: number, grade: Grade): number {
    return this.tally().get(tallyKey(workerId, reasonId, grade)) ?? 0;
  }

  protected clearProblem(): void {
    this.problem.set(null);
  }

  /**
   * Saves the whole sheet — every reason — for printing, through the same
   * native dialog every other export uses.
   */
  protected async exportPdf(): Promise<void> {
    const scope = this.sheet()?.seriesName?.toLowerCase().replace(/\s+/g, '-') ?? 'all-series';
    this.exporting.set(true);

    try {
      const chosen = await this.zone.runOutsideAngular(() =>
        save({
          defaultPath: `scanning-sheet-${scope}.pdf`,
          filters: [{ name: 'PDF document', extensions: ['pdf'] }],
        }),
      );
      const path = await this.zone.run(() => chosen);

      // Cancelled — not an error, and not worth a toast.
      if (!path) {
        return;
      }

      const written = await this.api.exportBarcodesPdf(this.seriesId(), path);
      this.notify.success(`Saved to ${written}`);
      await this.reveal(written);
    } catch (error) {
      this.notify.fromCommand(error, 'Could not write the scanning sheet.');
    } finally {
      this.exporting.set(false);
    }
  }

  private async reveal(path: string): Promise<void> {
    try {
      await this.zone.runOutsideAngular(() => openPath(path));
    } catch {
      this.notify.info('The sheet was saved, but could not be opened automatically.');
    }
  }

  protected readonly barcodeWidth = BARCODE_WIDTH;
  protected readonly barcodeHeight = BARCODE_HEIGHT;
}

function tallyKey(workerId: number, reasonId: number, grade: Grade): string {
  return `${workerId}:${reasonId}:${grade}`;
}

/** Matches the quiet zone the encoder builds into `moduleCount`. */
const QUIET_ZONE = 10;

const BARCODE_WIDTH = 138;
const BARCODE_HEIGHT = 28;

/**
 * The bars of one symbol as a single SVG path, scaled so the symbol and both
 * quiet zones fill {@link BARCODE_WIDTH}. Even indices are bars, odd ones the
 * spaces between them.
 */
function barsPath(symbol: BarcodeSymbol): string {
  const module = BARCODE_WIDTH / symbol.moduleCount;
  const parts: string[] = [];
  let pen = QUIET_ZONE * module;

  symbol.modules.forEach((modules, index) => {
    const run = modules * module;
    if (index % 2 === 0) {
      parts.push(`M${pen.toFixed(2)} 0h${run.toFixed(2)}v${BARCODE_HEIGHT}h-${run.toFixed(2)}z`);
    }
    pen += run;
  });

  return parts.join('');
}

function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return fallback;
}
