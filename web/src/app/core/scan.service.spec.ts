import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScanService } from './scan.service';

/**
 * The page-wide listener is the fallback for a reader fired while nothing is
 * focused. Three screens now carry a scan box of their own, so what matters
 * most here is what this does *not* take: a scan the box is already handling
 * would otherwise be recorded twice from one pass of the reader.
 */
describe('ScanService', () => {
  let service: ScanService;
  let injector: Injector;
  let codes: string[];
  let host: HTMLElement;

  /** A reader types fast and finishes with Enter. */
  function scan(code: string, target: EventTarget = document.body): void {
    for (const key of code) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    injector = TestBed.inject(Injector);
    service = TestBed.inject(ScanService);

    host = document.createElement('div');
    document.body.appendChild(host);

    codes = [];
    runInInjectionContext(injector, () => {
      service.listen(TestBed.inject(DestroyRef)).subscribe((code) => codes.push(code));
    });
  });

  afterEach(() => host.remove());

  it('takes a scan made while nothing is focused', () => {
    scan('300001000444');
    expect(codes).toEqual(['300001000444']);
  });

  it('leaves a scan alone when a field is already taking it', () => {
    const box = document.createElement('input');
    host.appendChild(box);

    scan('300001000444', box);

    // The box records it. If this listener took it as well, one pass of the
    // reader would put two entries in the register.
    expect(codes).toEqual([]);
  });

  it('leaves the search box to its own typing', () => {
    const search = document.createElement('input');
    search.type = 'search';
    host.appendChild(search);

    scan('300001000444', search);

    expect(codes).toEqual([]);
  });

  it('ignores a person typing, who is slower than a reader', async () => {
    for (const key of '3000') {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Only the last keystroke was still inside the burst window, which is far
    // too short to be a code.
    expect(codes).toEqual([]);
  });
});
