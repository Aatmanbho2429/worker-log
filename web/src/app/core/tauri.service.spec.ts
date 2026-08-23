import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TauriService } from './tauri.service';

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

describe('TauriService', () => {
  let service: TauriService;
  let zone: NgZone;

  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();

    TestBed.configureTestingModule({});
    service = TestBed.inject(TauriService);
    zone = TestBed.inject(NgZone);
  });

  describe('call', () => {
    it('resolves inside the Angular zone even when called from outside it', async () => {
      invokeMock.mockResolvedValue('ok');

      // A caller that has stepped outside the zone must not silently lose
      // change detection for the result.
      const result = await zone.runOutsideAngular(() => service.call<string>('app_info'));

      expect(result).toBe('ok');
      expect(invokeMock).toHaveBeenCalledWith('app_info', undefined);
    });

    it('passes arguments through', async () => {
      invokeMock.mockResolvedValue(null);
      await service.call('delete_worker', { id: 7 });
      expect(invokeMock).toHaveBeenCalledWith('delete_worker', { id: 7 });
    });

    it('rejects with whatever the command rejected with', async () => {
      const failure = { kind: 'conflict', message: 'already exists' };
      invokeMock.mockRejectedValue(failure);

      await expect(service.call('create_series')).rejects.toEqual(failure);
    });
  });

  describe('on', () => {
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

      service.on<string>('worker-log://data-changed').subscribe((payload) => {
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

      const subscription = service.on('worker-log://data-changed').subscribe();
      await Promise.resolve();
      subscription.unsubscribe();

      expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('still unlistens when torn down before registration completes', async () => {
      // Unsubscribing during that await would otherwise leak the listener.
      const unlisten = vi.fn();
      let settle: ((stop: () => void) => void) | undefined;
      listenMock.mockImplementation(() => new Promise((resolve) => (settle = resolve)));

      const subscription = service.on('worker-log://data-changed').subscribe();
      subscription.unsubscribe();

      settle!(unlisten);
      await Promise.resolve();
      await Promise.resolve();

      expect(unlisten).toHaveBeenCalledTimes(1);
    });
  });
});
