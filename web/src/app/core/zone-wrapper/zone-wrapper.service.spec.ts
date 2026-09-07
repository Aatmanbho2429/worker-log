import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ZoneWrapperService } from './zone-wrapper.service';

/**
 * The Tauri API is mocked so these run without a webview. What is being tested
 * is the zone handling on our side, not Tauri's transport.
 *
 * Vitest warns that these hoisted calls are "not at the top level" whichever
 * way round the file is written: the Angular unit-test builder bundles the
 * spec into a wrapper before vitest analyses it. The mocks do apply.
 */
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

describe('ZoneWrapperService', () => {
  let service: ZoneWrapperService;
  let zone: NgZone;

  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();

    TestBed.configureTestingModule({});
    service = TestBed.inject(ZoneWrapperService);
    zone = TestBed.inject(NgZone);
  });

  describe('invoke', () => {
    it('resolves inside the Angular zone even when called from outside it', async () => {
      invokeMock.mockResolvedValue({ statusCode: 200, message: 'OK', data: 'ok' });

      // A caller that has stepped outside the zone must not silently lose
      // change detection for the result.
      const result = await zone.runOutsideAngular(() => service.invoke<string>('app_info'));

      expect(result).toBe('ok');
      expect(invokeMock).toHaveBeenCalledWith('app_info', undefined);
    });

    it('passes arguments through', async () => {
      invokeMock.mockResolvedValue({ statusCode: 200, message: 'OK', data: null });
      await service.invoke('delete_worker', { id: 7 });
      expect(invokeMock).toHaveBeenCalledWith('delete_worker', { id: 7 });
    });

    it('unwraps the envelope on a 2xx status', async () => {
      const worker = { id: 7, firstName: 'A' };
      invokeMock.mockResolvedValue({ statusCode: 200, message: 'OK', data: worker });

      await expect(service.invoke('list_workers')).resolves.toEqual(worker);
    });

    /// The status → kind mapping is the inverse of `AppError::status_code()`
    /// in `src-tauri/src/error.rs` — `notify.service.ts`'s `fromCommand()`
    /// still branches on `kind`, not the raw status.
    it.each([
      [400, 'badRequest'],
      [404, 'notFound'],
      [409, 'conflict'],
      [500, 'internal'],
      [418, 'internal'],
    ] as const)('throws a %i envelope as kind %s', async (statusCode, kind) => {
      invokeMock.mockResolvedValue({ statusCode, message: 'already exists', data: null });

      await expect(service.invoke('create_series')).rejects.toEqual({
        kind,
        message: 'already exists',
      });
    });

    it('leaves a rejection that never reached the envelope to propagate as-is', async () => {
      // A missing command, a denied capability, a bug in the bridge — Tauri
      // itself rejects here, there is no envelope to read a status out of.
      const failure = new Error('command list_workers not found');
      invokeMock.mockRejectedValue(failure);

      await expect(service.invoke('list_workers')).rejects.toBe(failure);
    });
  });

  describe('listen', () => {
    it('runs the handler inside the Angular zone', async () => {
      // Tauri drives this callback from Rust, not from a task zone.js has
      // patched, so it arrives outside the zone. That is the whole reason the
      // service exists: without re-entering, nothing re-renders.
      let deliver: ((event: { payload: string }) => void) | undefined;
      listenMock.mockImplementation(
        (_name: string, handler: (event: { payload: string }) => void) => {
          deliver = handler;
          return Promise.resolve(() => {});
        },
      );

      const seenInZone: boolean[] = [];
      const payloads: string[] = [];

      service.listen<string>('worker-log://data-changed').subscribe((payload) => {
        seenInZone.push(NgZone.isInAngularZone());
        payloads.push(payload);
      });

      // Let the listen() promise settle.
      await Promise.resolve();
      expect(deliver).toBeDefined();

      // Deliver the way Tauri does: from outside the Angular zone.
      zone.runOutsideAngular(() => deliver!({ payload: 'waste' }));

      expect(payloads).toEqual(['waste']);
      expect(seenInZone).toEqual([true]);
    });

    it('unlistens when the subscription is torn down', async () => {
      const unlisten = vi.fn();
      listenMock.mockResolvedValue(unlisten);

      const subscription = service.listen('worker-log://data-changed').subscribe();
      await Promise.resolve();
      subscription.unsubscribe();

      expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('still unlistens when torn down before registration completes', async () => {
      // Unsubscribing during that await would otherwise leak the listener.
      const unlisten = vi.fn();
      let settle: ((stop: () => void) => void) | undefined;
      listenMock.mockImplementation(() => new Promise((resolve) => (settle = resolve)));

      const subscription = service.listen('worker-log://data-changed').subscribe();
      subscription.unsubscribe();

      settle!(unlisten);
      await Promise.resolve();
      await Promise.resolve();

      expect(unlisten).toHaveBeenCalledTimes(1);
    });
  });
});
