import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WasteLogService } from '../../core/waste-log.service';
import { WorkerLog } from '../../models';
import { ScanField } from './scan-field';

/**
 * The field stands between a barcode reader and the register, so what is tested
 * here is the handling either side of a scan: the box empties, the operator is
 * told what landed, and one pass of a reader records exactly one entry.
 */
function entry(gradeName = 'Grade 4'): WorkerLog {
  return {
    id: 1,
    workerId: 1,
    workerName: 'Worker A Worker A',
    reasonId: 4,
    reasonName: 'Bhatthi',
    gradeId: 4,
    gradeName,
    createdDate: '2026-08-28 15:24:00',
    modifiedDate: '2026-08-28 15:24:00',
  };
}

describe('ScanField', () => {
  let fixture: ComponentFixture<ScanField>;
  let recordScan: ReturnType<typeof vi.fn>;

  /** The digits a reader types, one keystroke at a time. */
  function type(code: string): void {
    const box: HTMLInputElement = fixture.nativeElement.querySelector('input');
    for (const digit of code) {
      box.value += digit;
      box.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
  }

  function box(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input');
  }

  beforeEach(async () => {
    recordScan = vi.fn().mockResolvedValue({ entry: entry() });

    await TestBed.configureTestingModule({
      imports: [ScanField],
      providers: [{ provide: WasteLogService, useValue: { recordScan } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanField);
    fixture.detectChanges();
  });

  it('empties the box once a scan is recorded, and says what landed', async () => {
    type('300001000444');
    await fixture.whenStable();
    fixture.detectChanges();

    // The box has to be empty in the DOM, not merely in the signal behind it:
    // a reader types straight into the element and would otherwise append its
    // next scan to the last one.
    expect(box().value).toBe('');
    expect(recordScan).toHaveBeenCalledExactlyOnceWith('300001000444');
    expect(fixture.nativeElement.textContent).toContain('Worker A Worker A');
    expect(fixture.nativeElement.textContent).toContain('Bhatthi');
  });

  it('puts the caret back in the box, so the next scan lands', async () => {
    type('300001000444');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.activeElement).toBe(box());
  });

  /**
   * The box is never disabled, not even for the instant a write is in flight.
   *
   * This is what actually keeps the caret: a browser blurs an element the
   * moment it is disabled and refuses to focus it back while it stays that way,
   * and the re-focus in `finally` runs before change detection has removed the
   * attribute — so the caret would be dropped on the floor. It also means a
   * reader part-way through a burst never has keystrokes swallowed.
   *
   * The focus assertions elsewhere in this file cannot catch that: the test DOM
   * lets a disabled element take focus, where a real one does not.
   */
  it('never disables the box, even mid-write', async () => {
    let finish!: (value: unknown) => void;
    recordScan.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    type('300001000444');
    fixture.detectChanges();

    expect(recordScan).toHaveBeenCalledOnce();
    expect(box().disabled).toBe(false);

    finish({ entry: entry() });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(box().disabled).toBe(false);
  });

  /// The caret has to survive a scan taken from the button too.
  it('takes the caret back after the button is used', async () => {
    type('30000100044');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    button.focus();
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(box().disabled).toBe(false);
    expect(document.activeElement).toBe(box());
  });

  /// A reader that sends Enter would otherwise be counted twice: once by the
  /// length check, once by the key.
  it('records one entry per scan even when the reader sends Enter', async () => {
    type('300001000444');
    box().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(recordScan).toHaveBeenCalledTimes(1);
    expect(box().value).toBe('');
  });

  /// A reader with no suffix configured simply stops typing at the last digit.
  it('records without waiting for a key that may never come', async () => {
    type('300001000444');
    await fixture.whenStable();

    expect(recordScan).toHaveBeenCalledTimes(1);
  });

  it('leaves a rejected code reported and the box ready for the next one', async () => {
    recordScan.mockRejectedValue({ kind: 'notFound', message: 'That barcode is not on the sheet.' });

    type('399999000444');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(box().value).toBe('');
    expect(fixture.nativeElement.textContent).toContain('not on the sheet');
  });

  it('hands the recorded entry to the screen it sits on', async () => {
    const seen: WorkerLog[] = [];
    fixture.componentInstance.recorded.subscribe((value) => seen.push(value));

    type('300001000444');
    await fixture.whenStable();

    expect(seen).toEqual([entry()]);
  });
});
