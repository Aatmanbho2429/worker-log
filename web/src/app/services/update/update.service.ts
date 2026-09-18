import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { TAURI_EVENTS } from '../../core/tauri/tauri-events.const';
import { UpdateInfo } from '../../models';
import { UpdateProgress } from '../../models/events';

/**
 * Talks to the three `update_*` Tauri commands and the two update events. The
 * app-wide state built on top of these — the banner's signals — is
 * `core/updates.service.ts`, not here; this service only crosses the bridge.
 * The 2-hourly background poll lives entirely in Rust
 * (`updater::start_background_checks`); `available` is how its result
 * arrives here.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  /** `null` means the app is already on the latest version. */
  check(): Promise<UpdateInfo | null> {
    return this.zoneWrapper.invoke<UpdateInfo | null>(TAURI_COMMANDS.updateCheck);
  }

  /**
   * Downloads, verifies and installs the update, then restarts the app. On
   * success this promise never actually resolves in the running window — the
   * process exits and relaunches — so callers only ever see it reject.
   */
  install(): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.updateInstall);
  }

  /** Opens the GitHub releases page in the system browser. */
  openReleasesPage(): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.updateOpenReleasesPage);
  }

  /** Fires repeatedly while `install()` is downloading or installing. */
  readonly progress: Observable<UpdateProgress> = this.zoneWrapper.listen<UpdateProgress>(
    TAURI_EVENTS.updateProgress,
  );

  /** Fires when the background poll (every 2 hours, Rust-side) finds a newer version. */
  readonly available: Observable<UpdateInfo> = this.zoneWrapper.listen<UpdateInfo>(
    TAURI_EVENTS.updateAvailable,
  );
}
