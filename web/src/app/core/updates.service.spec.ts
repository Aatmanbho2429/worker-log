import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdatesService } from './updates.service';
import { UpdateService } from '../services/update/update.service';
import { UpdateInfo } from '../models';
import { UpdateProgress } from '../models/events';

function info(version: string): UpdateInfo {
  return { version, currentVersion: '0.1.0', notes: `Notes for ${version}` };
}

/** Flushes the microtask + timer queue so a fire-and-forget `.then/.catch` settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * `UpdateService` (the Tauri-calling layer) is mocked so this exercises the
 * state machine on top of it, not the bridge — the same split as
 * `zone-wrapper.service.spec.ts` mocking `@tauri-apps/api` one layer further
 * down.
 */
describe('UpdatesService', () => {
  let service: UpdatesService;
  let progress$: Subject<UpdateProgress>;
  let check: ReturnType<typeof vi.fn>;
  let install: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    progress$ = new Subject<UpdateProgress>();
    check = vi.fn();
    install = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: UpdateService,
          useValue: {
            check,
            install,
            openReleasesPage: vi.fn(),
            progress: progress$.asObservable(),
          },
        },
      ],
    });

    service = TestBed.inject(UpdatesService);
  });

  it('a failed background check sets no error and leaves the banner hidden', async () => {
    check.mockRejectedValue({ kind: 'internal', message: 'offline' });

    // `start()` skips the background poll under `isDevMode()` — true in
    // tests — so the silent path is exercised directly. That is the one
    // behaviour `checkNow()` cannot stand in for: it deliberately propagates
    // its error instead of swallowing it.
    (service as unknown as { checkInBackground(): void }).checkInBackground();
    await flush();

    expect(service.available()).toBeNull();
    expect(service.error()).toBeNull();
    expect(service.bannerVisible()).toBe(false);
  });

  it('an available update makes the banner visible', async () => {
    check.mockResolvedValue(info('0.2.0'));

    const result = await service.checkNow();

    expect(result).toBe('available');
    expect(service.available()).toEqual(info('0.2.0'));
    expect(service.bannerVisible()).toBe(true);
  });

  it('reports upToDate and leaves the banner hidden when nothing is offered', async () => {
    check.mockResolvedValue(null);

    const result = await service.checkNow();

    expect(result).toBe('upToDate');
    expect(service.bannerVisible()).toBe(false);
  });

  it('dismiss hides the banner for that version but not for a newer one', async () => {
    check.mockResolvedValue(info('0.2.0'));
    await service.checkNow();

    service.dismiss();
    expect(service.bannerVisible()).toBe(false);

    // The same version re-offered (e.g. the next poll) stays hidden.
    check.mockResolvedValue(info('0.2.0'));
    await service.checkNow();
    expect(service.bannerVisible()).toBe(false);

    // A newer version shows again — dismissing is per-version, not forever.
    check.mockResolvedValue(info('0.3.0'));
    await service.checkNow();
    expect(service.bannerVisible()).toBe(true);
  });

  it('a failed install clears installing, records the error, and shows the banner even if dismissed', async () => {
    check.mockResolvedValue(info('0.2.0'));
    await service.checkNow();
    service.dismiss();
    expect(service.bannerVisible()).toBe(false);

    install.mockRejectedValue({ kind: 'internal', message: 'signature verification failed' });
    await service.install();

    expect(service.installing()).toBe(false);
    expect(service.error()).toBe('signature verification failed');
    // An error always shows the banner — there is nowhere else for the
    // operator to see it or retry from.
    expect(service.bannerVisible()).toBe(true);
  });

  it('progress with no Content-Length reports an indeterminate percent', () => {
    service.start();

    progress$.next({ downloaded: 500, total: null });

    expect(service.installing()).toBe(true);
    expect(service.percent()).toBeNull();
  });

  it('progress with a total reports a rounded percent', () => {
    service.start();

    progress$.next({ downloaded: 50, total: 200 });

    expect(service.percent()).toBe(25);
  });
});
