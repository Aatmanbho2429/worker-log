import { Injectable, NgZone, inject } from '@angular/core';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';
import { Observable } from 'rxjs';

import { ApiResponse } from '../../models/response/apiResponse';

/**
 * The shape a rejected command surfaces as on the JS side. Not what Rust
 * sends any more — see {@link ApiResponse} — but what `invoke()` throws once
 * it has read a non-2xx `statusCode`, so every existing `catch` block and
 * `notify.fromCommand()` call keeps working against the same shape it always
 * has.
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

/** The inverse of `AppError::status_code()` in `src-tauri/src/error.rs`. */
function kindFor(statusCode: number): CommandError['kind'] {
  switch (statusCode) {
    case 400:
      return 'badRequest';
    case 404:
      return 'notFound';
    case 409:
      return 'conflict';
    default:
      return 'internal';
  }
}

/**
 * The bridge to the Rust side, and the one place that worries about zones.
 * `.claude/rules/zone-wrapper.md` and `.claude/rules/tauri-ipc.md` — this is
 * the only file that imports `@tauri-apps/api`; every other service or
 * component goes through `invoke()`/`listen()` here.
 *
 * Three different problems are handled here:
 *
 * 1. `invoke()` (the Tauri one) returns a normal promise, and zone.js patches
 *    `Promise`, so a call made from inside the Angular zone resolves back
 *    inside it. That is fine on its own — but a caller that has deliberately
 *    stepped outside the zone would silently lose change detection, so
 *    {@link ZoneWrapperService.invoke} re-enters explicitly rather than
 *    depending on where it was invoked from.
 *
 * 2. Every command answers with an {@link ApiResponse} envelope
 *    (`.claude/rules/api-response-format.md`) rather than rejecting — Tauri
 *    always resolves the promise. `invoke()` is what turns that back into the
 *    `Promise<T>` every caller already expects: a 2xx `statusCode` resolves
 *    with `data`, anything else throws a {@link CommandError} built from the
 *    envelope's `statusCode` and `message`. A rejection that never reached
 *    the envelope at all — a missing command, a permission the capability
 *    file does not grant, a bug in the bridge — is left to propagate as-is;
 *    `notify.service.ts`'s `fromCommand()` already has a fallback for that.
 *
 * 3. `listen()` (the Tauri one) is the real trap. Tauri delivers events by
 *    calling a callback it registered on `window`, driven from Rust rather
 *    than from a JavaScript task that zone.js has patched. The handler
 *    therefore runs *outside* the Angular zone and nothing re-renders, even
 *    though the signal or field updated correctly.
 *    {@link ZoneWrapperService.listen} registers the listener outside the
 *    zone (so the subscription plumbing does not schedule pointless change
 *    detection) and runs the handler back inside it.
 */
@Injectable({ providedIn: 'root' })
export class ZoneWrapperService {
  private readonly zone = inject(NgZone);

  /**
   * Calls a Rust command and resolves inside the Angular zone with the
   * envelope's `data` — or rejects with a {@link CommandError} once the
   * `statusCode` says the command failed.
   */
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const envelope = await this.zone.runOutsideAngular(() =>
      tauriInvoke<ApiResponse<T>>(command, args),
    );

    return this.zone.run(() => {
      if (envelope.statusCode >= 200 && envelope.statusCode < 300) {
        // Only the failure branch leaves `data` empty — see `ApiResponse`.
        return envelope.data as T;
      }

      const error: CommandError = { kind: kindFor(envelope.statusCode), message: envelope.message };
      throw error;
    });
  }

  /**
   * Subscribes to a backend event. The handler always runs inside the Angular
   * zone, so updating a signal from it re-renders as you would expect.
   */
  listen<T>(event: string): Observable<T> {
    return new Observable<T>((subscriber) => {
      let unlisten: UnlistenFn | undefined;
      let cancelled = false;

      this.zone.runOutsideAngular(() => {
        tauriListen<T>(event, (received) => {
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
