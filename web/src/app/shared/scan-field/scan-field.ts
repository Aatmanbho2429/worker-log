import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { WasteLogService } from '../../core/waste-log.service';
import { WorkerLog } from '../../models';
import { isCommandError } from '../../core/tauri.service';
import { PrimengComponentsModule } from '../primeng-components-module';

/**
 * The digits a waste-log barcode carries — see `barcode.rs`. A scanner that has
 * not been given an Enter suffix simply stops typing at the twelfth, so the
 * field submits on its own once it has that many rather than waiting for a key
 * that may never come.
 */
const CODE_LENGTH = 12;

/**
 * A box to scan into.
 *
 * A handheld scanner is a keyboard: it types the code and usually presses
 * Enter. So this is a plain text field — which means it takes a typed or pasted
 * code just as well, and the register can be worked and tested without any
 * hardware at all, using the digits printed under every barcode.
 *
 * The field keeps itself focused, because a scanner types wherever the caret
 * happens to be and an operator holding a piece of sanitaryware has no spare
 * hand to put it back.
 */
@Component({
  selector: 'app-scan-field',
  imports: [PrimengComponentsModule],
  templateUrl: './scan-field.html',
  styleUrl: './scan-field.scss',
})
export class ScanField {
  private readonly api = inject(WasteLogService);

  /**
   * Whether to report the outcome inline. A screen with a confirmation panel of
   * its own turns this off and listens instead, so a scan is not announced
   * twice in two different places.
   */
  readonly showResult = input(true);

  /** The entry a scan recorded, for the host screen to fold into its own state. */
  readonly recorded = output<WorkerLog>();

  /** Why a scan was refused, already phrased for the operator. */
  readonly failed = output<string>();

  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  protected readonly code = signal('');

  /// Counted rather than flagged: a second scan may arrive before the first
  /// write has come back, and the button should stay busy until both have.
  private readonly inFlight = signal(0);
  protected readonly busy = computed(() => this.inFlight() > 0);
  protected readonly last = signal<WorkerLog | null>(null);
  protected readonly problem = signal<string | null>(null);

  protected readonly ready = computed(() => this.code().trim().length > 0);

  constructor() {
    // Take the caret on arrival, so the first scan lands without a click.
    effect(() => this.box().nativeElement.focus());
  }

  protected onInput(value: string): void {
    this.code.set(value);

    // Long enough to be a whole code: record it without waiting for Enter.
    if (value.trim().length >= CODE_LENGTH) {
      void this.submit();
    }
  }

  protected async submit(): Promise<void> {
    const code = this.code().trim();
    if (!code) {
      return;
    }

    // Cleared first, and that empty box is what stops a double record: a reader
    // that sends Enter after the twelfth digit arrives here again on a field
    // the length check has already submitted, and leaves by the guard above.
    this.clear();
    this.inFlight.update((n) => n + 1);

    try {
      const { entry } = await this.api.recordScan(code);
      this.problem.set(null);
      this.last.set(entry);
      this.recorded.emit(entry);
    } catch (error) {
      const message = messageOf(error, 'That barcode could not be recorded.');
      this.last.set(null);
      this.problem.set(message);
      this.failed.emit(message);
    } finally {
      this.inFlight.update((n) => n - 1);
      // Back to the box, so the next scan lands without anyone reaching for a
      // mouse — after a click on Record, the caret would be on the button.
      this.box().nativeElement.focus();
    }
  }

  protected dismiss(): void {
    this.problem.set(null);
    this.box().nativeElement.focus();
  }

  /**
   * Empties the box, in the DOM as well as in the signal.
   *
   * The element is written to directly because clearing happens *during* the
   * input event that filled it, and a binding alone does not reliably land a
   * value back on the element it is currently reading from. The signal drives
   * everything else on screen, so both have to go.
   */
  private clear(): void {
    this.code.set('');
    this.box().nativeElement.value = '';
  }
}

/**
 * The message a rejected command carried. Every reason a scan can fail — a
 * code off a passing carton, a misread digit, a worker since removed — comes
 * back already phrased for the operator, so it is shown as it is.
 */
function messageOf(error: unknown, fallback: string): string {
  if (isCommandError(error) && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
