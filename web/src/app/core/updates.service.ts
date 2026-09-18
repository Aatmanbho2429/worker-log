import { Injectable, computed, inject, isDevMode, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { isCommandError } from './zone-wrapper/zone-wrapper.service';
import { UpdateService } from '../services/update/update.service';
import { UpdateInfo } from '../models';

/**
 * App-wide update state: a click-to-install banner, not a forced overlay —
 * a shop-floor terminal must never be locked out of logging waste by an
 * update. Cross-cutting rather than owned by one screen, so it lives in
 * `core/` next to `DataChangesService`, the other app-wide stream built on
 * `ZoneWrapperService`.
 *
 * `services/update/update.service.ts` is the thin Tauri-calling layer this
 * builds on; this service owns the state a banner (or the Settings screen's
 * manual "Check for updates" button) actually renders.
 */
@Injectable({ providedIn: 'root' })
export class UpdatesService {
  private readonly updateApi = inject(UpdateService);

  readonly available = signal<UpdateInfo | null>(null);
  readonly installing = signal(false);
  /** 0-100, or `null` while the download has no `Content-Length` (indeterminate). */
  readonly percent = signal<number | null>(0);
  readonly error = signal<string | null>(null);
  /** For the Settings screen's manual button, not the background poll. */
  readonly checking = signal(false);

  // In memory only: a relaunch — or a version newer than the one dismissed —
  // shows the banner again. There is no server-side "this release is
  // optional" flag; every offered version is dismissible, none is forced.
  private readonly dismissedVersion = signal<string | null>(null);

  readonly bannerVisible = computed(() => {
    const info = this.available();
    if (!info) return false;
    return this.installing() || !!this.error() || info.version !== this.dismissedVersion();
  });

  private started = false;
  private subs: Subscription[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  // Re-check every 6 hours so a long-running session still gets told.
  private static readonly POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

  /** Idempotent — safe to call from more than one place. Call once, from `App`'s constructor, so the check is already running by the time the shell mounts. */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Subscribed before the first `install()` can possibly run, so a
    // progress event fired mid-download is never lost.
    this.subs.push(
      this.updateApi.progress.subscribe((progress) => {
        this.installing.set(true);
        this.percent.set(
          progress.total
            ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
            : null,
        );
      }),
    );

    // Background checks only in a real build — every `npm run dev` session
    // with an older local version must not raise the banner. The manual
    // "Check for updates" button (`checkNow`) still works in dev; that is
    // how the banner gets tested without a signed release build.
    if (isDevMode()) return;

    this.checkInBackground();
    this.timer = setInterval(() => this.checkInBackground(), UpdatesService.POLL_INTERVAL_MS);
  }

  /**
   * A failed background check is not itself news — offline, GitHub
   * unreachable, a corporate proxy — so it never surfaces to the operator.
   * The banner simply stays hidden. Contrast `checkNow()`, which is the
   * manual button and does propagate its error.
   */
  private checkInBackground(): void {
    this.updateApi
      .check()
      .then((info) => {
        if (info) this.available.set(info);
      })
      .catch((err) => console.warn('[updater] background check failed:', err));
  }

  /** The Settings screen's manual button. Errors propagate to the caller, who shows them — unlike the silent background poll. */
  async checkNow(): Promise<'available' | 'upToDate'> {
    this.checking.set(true);
    try {
      const info = await this.updateApi.check();
      if (info) {
        this.available.set(info);
        return 'available';
      }
      return 'upToDate';
    } finally {
      this.checking.set(false);
    }
  }

  /**
   * Downloads, verifies and installs the update, then restarts the app.
   * Success never actually resolves here — the process exits and relaunches
   * before the promise would settle — so only the rejection path matters.
   */
  async install(): Promise<void> {
    this.installing.set(true);
    this.percent.set(0);
    this.error.set(null);
    try {
      await this.updateApi.install();
    } catch (err) {
      this.installing.set(false);
      this.error.set(isCommandError(err) ? err.message : String(err));
    }
  }

  /** A mandatory update cannot be waved away — but every update here is optional, so this always applies. */
  dismiss(): void {
    const info = this.available();
    if (info) this.dismissedVersion.set(info.version);
  }

  /** Manual-download fallback for when the in-app installer itself is broken. */
  openReleasesPage(): void {
    this.updateApi
      .openReleasesPage()
      .catch((err) => console.warn('[updater] could not open releases page:', err));
  }

  /** Only meaningful in tests — the service otherwise lives for the app's lifetime. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.subs.forEach((sub) => sub.unsubscribe());
    this.subs = [];
    this.started = false;
  }
}
