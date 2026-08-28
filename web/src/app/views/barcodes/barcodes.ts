import { Component, DestroyRef, NgZone, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';

import { gradeToneClass } from '../../core/grade-tone';
import { NotifyService } from '../../core/notify.service';
import { ScanService } from '../../core/scan.service';
import { WasteLogService } from '../../core/waste-log.service';
import { BarcodeSheet, BarcodeSymbol, Grade, SeriesOfProduct, WorkerLog } from '../../models';
import { affects } from '../../models/events';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { ScanField } from '../../shared/scan-field/scan-field';

/** An entry the reader just recorded, kept briefly so the operator sees it. */
interface Recorded {
  worker: string;
  reason: string;
  grade: string;
  tone: string;
  at: string;
}

/**
 * One box of the grid: the barcode standing in for one worker's grade button
 * under one reason.
 *
 * The bars are reduced to a single SVG path here rather than drawn as one
 * `<rect>` each. A full sheet is hundreds of barcodes; one path apiece is two
 * orders of magnitude less DOM, and it is computed once when the sheet loads.
 */
interface Cell {
  reasonId: number;
  gradeId: number;
  gradeName: string;
  /** The class carrying this grade's colour variables. */
  tone: string;
  /** Both absent when no barcode exists for this button. */
  code: string | null;
  path: string | null;
}

/** One worker's line across the whole sheet. */
interface Row {
  workerId: number;
  name: string;
  seriesName: string;
  /** Reason-major, so `cells[i]` lines up with `columns()[i]`. */
  cells: Cell[];
}

/** A reason's heading, spanning one column per grade. */
interface Group {
  reasonId: number;
  reasonName: string;
}

/**
 * The scanning station: the paper reject sheet with barcodes in the boxes.
 *
 * The register it replaces is one wide grid — workers down the left, a pair of
 * columns per reason across the top, a box where they meet — and this is that
 * grid with a barcode printed in every box. Scanning one records exactly what
 * tapping the matching button on the waste screen records, so a reader stands
 * in for a finger without the operator having to hold anything in their head.
 *
 * Nothing is hidden and nothing has to be picked first: a worker's whole line
 * is in front of the operator, the way it is on paper. The number in each box
 * is what the reader has put through it this session.
 */
@Component({
  selector: 'app-barcodes',
  imports: [PrimengComponentsModule, FormsModule, ScanField],
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
   * `workerId:reasonId:gradeId` — the box they landed in.
   *
   * Deliberately a session tally rather than the register's totals: the
   * operator wants to see that the beep landed, and a running count they can
   * check against the pieces in front of them is more use for that than a
   * month-to-date figure.
   */
  private readonly tally = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly grades = computed<Grade[]>(() => this.sheet()?.grades ?? []);

  /** The reason headings, each spanning `grades().length` columns. */
  protected readonly groups = computed<Group[]>(() =>
    (this.sheet()?.reasons ?? []).map((reason) => ({
      reasonId: reason.reasonId,
      reasonName: reason.reasonName,
    })),
  );

  /** The grade sub-headings, reason-major — one per body column. */
  protected readonly columns = computed(() => {
    const grades = this.grades();
    return this.groups().flatMap((group) =>
      grades.map((grade, index) => ({
        reasonId: group.reasonId,
        gradeId: grade.id,
        gradeName: grade.name,
        tone: gradeToneClass(index),
      })),
    );
  });

  /**
   * The whole grid, pivoted from the reason-grouped sheet the backend sends
   * into the worker-per-line shape the paper register uses.
   */
  private readonly matrix = computed<Row[]>(() => {
    const sheet = this.sheet();
    if (!sheet) {
      return [];
    }

    const tones = new Map(sheet.grades.map((grade, index) => [grade.id, gradeToneClass(index)]));

    // Every reason lists every worker, so one lookup table per reason beats
    // searching its rows again for each worker.
    const byReason = sheet.reasons.map((reason) => ({
      reasonId: reason.reasonId,
      workers: new Map(reason.rows.map((row) => [row.workerId, row])),
    }));

    // The first reason fixes the running order; the rest hold the same set.
    return (sheet.reasons[0]?.rows ?? []).map((worker) => ({
      workerId: worker.workerId,
      name: worker.name,
      seriesName: worker.seriesName,
      cells: byReason.flatMap((reason) => {
        const tiles = new Map(
          (reason.workers.get(worker.workerId)?.tiles ?? []).map((tile) => [tile.gradeId, tile]),
        );

        return sheet.grades.map((grade) => {
          const tile = tiles.get(grade.id);
          return {
            reasonId: reason.reasonId,
            gradeId: grade.id,
            gradeName: grade.name,
            tone: tones.get(grade.id) ?? gradeToneClass(0),
            // A button with no barcode row cannot be scanned, so its box is
            // left empty rather than filled with bars that resolve to nothing.
            code: tile?.symbol.code ?? null,
            path: tile ? barsPath(tile.symbol) : null,
          };
        });
      }),
    }));
  });

  /** The grid with the worker filter applied. */
  protected readonly rows = computed<Row[]>(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.matrix();
    }
    return this.matrix().filter((row) =>
      `${row.name} ${row.seriesName}`.toLowerCase().includes(term),
    );
  });

  protected readonly barcodeCount = computed(() =>
    this.rows().reduce((total, row) => total + row.cells.filter((cell) => cell.code).length, 0),
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

    // A worker added, a reason renamed or a grade created changes what belongs
    // on the sheet. Waste taps do not: they change counts, and the sheet shows
    // no totals.
    this.api.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((change) => {
      if (affects(change, 'workers', 'reasons', 'series', 'grades')) {
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

  /**
   * Scrolls a reason's columns into view. Nothing is hidden; the grid is wider
   * than the screen, and this saves dragging across to reach a reason.
   */
  protected jumpTo(reasonId: number): void {
    document
      .getElementById(`reason-${reasonId}`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

  /**
   * A scan made while nothing is focused. The scan box handles the rest, so
   * this is only the fallback for a reader fired at the grid itself.
   */
  private async onScan(code: string): Promise<void> {
    try {
      this.onRecorded(await this.api.recordScan(code).then(({ entry }) => entry));
    } catch (error) {
      this.problem.set(messageOf(error, 'That barcode could not be recorded.'));
    }
  }

  /**
   * One scan, one entry, however it arrived — through the box or off the page.
   * The box reports nothing itself on this screen; the panel above the sheet
   * already says what landed, and saying it twice would only split attention.
   */
  protected onRecorded(entry: WorkerLog): void {
    this.problem.set(null);
    this.bump(entry.workerId, entry.reasonId, entry.gradeId);
    this.recent.update((entries) =>
      [
        {
          worker: entry.workerName,
          reason: entry.reasonName,
          grade: entry.gradeName,
          tone: this.toneFor(entry.gradeId),
          at: new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        },
        ...entries,
      ].slice(0, 8),
    );
  }

  protected onFailed(message: string): void {
    this.problem.set(message);
  }

  /** A grade deleted since the scan has no column left, and falls back. */
  private toneFor(gradeId: number): string {
    const index = this.grades().findIndex((grade) => grade.id === gradeId);
    return gradeToneClass(Math.max(0, index));
  }

  private bump(workerId: number, reasonId: number, gradeId: number): void {
    this.tally.update((counts) => {
      const next = new Map(counts);
      const key = tallyKey(workerId, reasonId, gradeId);
      next.set(key, (next.get(key) ?? 0) + 1);
      return next;
    });
  }

  protected scanned(workerId: number, cell: Cell): number {
    return this.tally().get(tallyKey(workerId, cell.reasonId, cell.gradeId)) ?? 0;
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

function tallyKey(workerId: number, reasonId: number, gradeId: number): string {
  return `${workerId}:${reasonId}:${gradeId}`;
}

/** Matches the quiet zone the encoder builds into `moduleCount`. */
const QUIET_ZONE = 10;

const BARCODE_WIDTH = 128;
const BARCODE_HEIGHT = 26;

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
