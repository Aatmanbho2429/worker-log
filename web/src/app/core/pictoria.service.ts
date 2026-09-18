import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from './zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from './tauri/tauri-commands.const';

/**
 * The sidebar credit's link — opens pictoria.shop in the system browser.
 * The URL itself is hardcoded in Rust (`commands::open_pictoria_site`), never
 * passed from here; this is just the thin call across the bridge, the same
 * shape as `UpdateService.openReleasesPage()`.
 */
@Injectable({ providedIn: 'root' })
export class PictoriaService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  openSite(): Promise<void> {
    return this.zoneWrapper.invoke<void>(TAURI_COMMANDS.openPictoriaSite);
  }
}
