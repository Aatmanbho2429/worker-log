import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { isCommandError } from './zone-wrapper/zone-wrapper.service';
import { UpdateService } from '../services/update/update.service';
import { UpdateInfo } from '../models';
import { UpdatePhase } from '../models/events';

/**
 * App-wide update state: a click-to-install banner, not a forced overlay —
 * a shop-floor terminal must never be locked out of logging waste by an
 * update. Cross-cutting rather than owned by one screen, so it lives in
 * `core/` next to `DataChangesService`, the other app-wide stream built on
 * `ZoneWrapperService`.
 *
 * `services/update/update.service.ts` is the thin Tauri-calling layer this
 * builds on; this service owns the state a banner (or the topbar's version
 * tag) actually renders. The 2-hourly background poll is not here — it runs
 * entirely in Rust (`updater::start_background_checks`), because a webview
 * timer is throttled while the window is hidden or minimised, which is
 * exactly the state a shop-floor terminal sits in for hours. This service
 * just listens for what that poll finds.
 */
@Injectable({ providedIn: 'root' })
export class UpdatesService {
  private readonly updateApi = inject(UpdateService);

  readonly available = signal<UpdateInfo | null>(null);
  readonly installing = signal(false);
  /** 0-100, or `null` while indeterminate — no `Content-Length` yet, or the installing phase. */
  readonly percent = signal<number | null>(null);
  /** Which stretch of the install `percent` describes; only meaningful while `installing()`. */
  readonly phase = signal<UpdatePhase>('downloading');
  readonly error = signal<string | null>(null);
  /** For the topbar version tag's manual check, not the background poll. */
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

  /** Idempotent — safe to call from more than one place. Call once, from `App`'s constructor, so listeners are wired before anything can fire. */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Subscribed before the first `install()` can possibly run, so a
    // progress event fired mid-download is never lost.
    this.subs.push(
      this.updateApi.progress.subscribe((progress) => {
        this.installing.set(true);
        this.phase.set(progress.phase);

        if (progress.phase === 'installing') {
          // The plugin gives no byte-level callback for this stretch —
          // always indeterminate.
          this.percent.set(null);
          return;
        }

        const next = progress.total
          ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
          : null;
        // Guard against a stray backward jump. A move to indeterminate, or
        // a same-or-forward percentage, always applies.
        const current = this.percent();
        if (next === null || current === null || next >= current) {
          this.percent.set(next);
        }
      }),
    );

    // The background poll itself runs in Rust, every 2 hours, skipped in dev
    // builds — see `updater::start_background_checks`. This just listens for
    // what it finds; per-version dismissal still applies (`bannerVisible()`
    // above), so a poll re-offering an already-dismissed version stays quiet.
    this.subs.push(this.updateApi.available.subscribe((info) => this.available.set(info)));
  }

  /** The topbar version tag's manual check. Errors propagate to the caller, who shows them — unlike the silent background poll. */
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
    this.percent.set(null);
    this.phase.set('downloading');
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
    this.subs.forEach((sub) => sub.unsubscribe());
    this.subs = [];
    this.started = false;
  }
}
