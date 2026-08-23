import { Injectable, NgZone, inject } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Observable } from 'rxjs';

/**
 * The shape a rejected command resolves to. Mirrors `CommandError` in Rust.
 */
export interface CommandError {
  kind: 'notFound' | 'badRequest' | 'conflict' | 'internal';
  message: string;
}

export function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CommandError).kind === 'string' &&
    typeof (value as CommandError).message === 'string'
  );
}

/**
 * The bridge to the Rust side, and the one place that worries about zones.
 *
 * Two different problems are handled here:
 *
 * 1. `invoke()` returns a normal promise, and zone.js patches `Promise`, so a
 *    call made from inside the Angular zone resolves back inside it. That is
 *    fine on its own — but a caller that has deliberately stepped outside the
 *    zone would silently lose change detection, so {@link call} re-enters
 *    explicitly rather than depending on where it was invoked from.
 *
 * 2. `listen()` is the real trap. Tauri delivers events by calling a callback
 *    it registered on `window`, driven from Rust rather than from a
 *    JavaScript task that zone.js has patched. The handler therefore runs
 *    *outside* the Angular zone and nothing re-renders, even though the
 *    signal or field updated correctly. {@link on} registers the listener
 *    outside the zone (so the subscription plumbing does not schedule
 *    pointless change detection) and runs the handler back inside it.
 */
@Injectable({ providedIn: 'root' })
export class TauriService {
  private readonly zone = inject(NgZone);

  /**
   * Calls a Rust command and resolves inside the Angular zone.
   */
  async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const result = await this.zone.runOutsideAngular(() => invoke<T>(command, args));
    return this.zone.run(() => result);
  }

  /**
   * Subscribes to a backend event. The handler always runs inside the Angular
   * zone, so updating a signal from it re-renders as you would expect.
   */
  on<T>(event: string): Observable<T> {
    return new Observable<T>((subscriber) => {
      let unlisten: UnlistenFn | undefined;
      let cancelled = false;

      this.zone.runOutsideAngular(() => {
        listen<T>(event, (received) => {
          this.zone.run(() => subscriber.next(received.payload));
        })
          .then((stop) => {
            // Unsubscribed before the listener finished registering.
            if (cancelled) {
              stop();
              return;
            }
            unlisten = stop;
          })
          .catch((error) => this.zone.run(() => subscriber.error(error)));
      });

      return () => {
        cancelled = true;
        unlisten?.();
      };
    });
  }
}
