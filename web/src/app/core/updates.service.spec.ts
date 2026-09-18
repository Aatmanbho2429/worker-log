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

/**
 * `UpdateService` (the Tauri-calling layer) is mocked so this exercises the
 * state machine on top of it, not the bridge — the same split as
 * `zone-wrapper.service.spec.ts` mocking `@tauri-apps/api` one layer further
 * down.
 *
 * The 2-hourly background poll itself is not testable from here any more —
 * it runs entirely in Rust (`updater::start_background_checks`), including
 * the "a failed check stays silent" rule. What *is* still this service's job,
 * and what these tests cover, is turning the `update-available` event that
 * poll fires into `available()` and the banner.
 */
describe('UpdatesService', () => {
  let service: UpdatesService;
  let progress$: Subject<UpdateProgress>;
  let available$: Subject<UpdateInfo>;
  let check: ReturnType<typeof vi.fn>;
  let install: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    progress$ = new Subject<UpdateProgress>();
    available$ = new Subject<UpdateInfo>();
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
            available: available$.asObservable(),
          },
        },
      ],
    });

    service = TestBed.inject(UpdatesService);
  });

  it('the update-available event makes the banner visible', () => {
    service.start();

    available$.next(info('0.2.0'));

    expect(service.available()).toEqual(info('0.2.0'));
    expect(service.bannerVisible()).toBe(true);
  });

  it('an available update makes the banner visible via the manual check too', async () => {
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

  it('a poll re-offering an already-dismissed version keeps the banner hidden', () => {
    service.start();

    available$.next(info('0.2.0'));
    service.dismiss();
    expect(service.bannerVisible()).toBe(false);

    available$.next(info('0.2.0'));
    expect(service.bannerVisible()).toBe(false);

    available$.next(info('0.3.0'));
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

  it('install() starts indeterminate, not at a dead 0%', () => {
    service.percent.set(37); // simulate a leftover value from a previous attempt
    void service.install();

    expect(service.percent()).toBeNull();
    expect(service.phase()).toBe('downloading');
  });

  it('downloading progress with no Content-Length reports an indeterminate percent', () => {
    service.start();

    progress$.next({ downloaded: 500, total: null, phase: 'downloading' });

    expect(service.installing()).toBe(true);
    expect(service.percent()).toBeNull();
  });

  it('downloading progress with a total reports a rounded percent', () => {
    service.start();

    progress$.next({ downloaded: 50, total: 200, phase: 'downloading' });

    expect(service.percent()).toBe(25);
  });

  it('ignores a downloading percent that moves backward', () => {
    service.start();

    progress$.next({ downloaded: 80, total: 100, phase: 'downloading' });
    expect(service.percent()).toBe(80);

    // A stray earlier chunk arriving late must not walk the bar backward.
    progress$.next({ downloaded: 40, total: 100, phase: 'downloading' });
    expect(service.percent()).toBe(80);

    progress$.next({ downloaded: 90, total: 100, phase: 'downloading' });
    expect(service.percent()).toBe(90);
  });

  it('the installing phase is always indeterminate, whatever it reports', () => {
    service.start();

    progress$.next({ downloaded: 100, total: 100, phase: 'downloading' });
    expect(service.percent()).toBe(100);

    progress$.next({ downloaded: 0, total: null, phase: 'installing' });
    expect(service.phase()).toBe('installing');
    expect(service.percent()).toBeNull();
  });
});
