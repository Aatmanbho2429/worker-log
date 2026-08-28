import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * Turns a handheld barcode scanner into a stream of codes.
 *
 * A scanner is a keyboard: it types the payload and presses Enter. What
 * separates it from a person is speed, so keystrokes are only treated as part
 * of one scan when they arrive in a burst. That means the search box on the
 * same screen still works normally, and a stray keypress never half-fills the
 * buffer and waits there to corrupt the next scan.
 */
@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly zone = inject(NgZone);

  /** Keystrokes further apart than this are a person typing, not a scanner. */
  private static readonly BURST_GAP_MS = 60;

  /** A partial code is abandoned rather than left to poison the next scan. */
  private static readonly RESET_MS = 400;

  private buffer = '';
  private lastKeyAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly scans = new Subject<string>();

  /**
   * Starts listening until `destroyRef` fires, and returns the codes read.
   *
   * Scoped to the component that asks rather than installed globally: a scan
   * writes to the register, and it should only be able to do that on the
   * screen the operator is actually looking at.
   */
  listen(destroyRef: DestroyRef): Observable<string> {
    const onKey = (event: KeyboardEvent) => this.accept(event);

    // Outside the zone: a scanner fires a dozen keydowns within a few
    // milliseconds and none of them should trigger change detection. The one
    // emit at the end re-enters.
    this.zone.runOutsideAngular(() => document.addEventListener('keydown', onKey, true));

    destroyRef.onDestroy(() => {
      document.removeEventListener('keydown', onKey, true);
      this.clear();
    });

    return this.scans.asObservable();
  }

  private accept(event: KeyboardEvent): void {
    // Whatever holds the caret owns the reader. A screen with a scan box on it
    // records through that box, and this listener is only the fallback for a
    // scan made while nothing is focused — otherwise both would fire and one
    // pass of the reader would be logged twice. It also means a scan aimed at
    // the search box stays in the search box, rather than being recorded and
    // filling the search with digits.
    if (isEditable(event.target)) {
      return;
    }

    const now = Date.now();
    const gap = now - this.lastKeyAt;
    this.lastKeyAt = now;

    if (event.key === 'Enter') {
      const code = this.buffer;
      this.clear();
      if (code.length >= 4) {
        // Swallow the Enter so it cannot also submit a focused form.
        event.preventDefault();
        this.zone.run(() => this.scans.next(code));
      }
      return;
    }

    // Only printable single characters are payload; Shift, Tab, the arrows and
    // the rest are not.
    if (event.key.length !== 1) {
      return;
    }

    if (gap > ScanService.BURST_GAP_MS) {
      this.buffer = '';
    }
    this.buffer += event.key;
    this.armReset();
  }

  private armReset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.clear(), ScanService.RESET_MS);
  }

  private clear(): void {
    this.buffer = '';
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Whether keystrokes aimed at `target` are already going somewhere. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
