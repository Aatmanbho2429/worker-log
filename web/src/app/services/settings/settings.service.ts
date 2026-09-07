import { Injectable, inject } from '@angular/core';

import { ZoneWrapperService } from '../../core/zone-wrapper/zone-wrapper.service';
import { TAURI_COMMANDS } from '../../core/tauri/tauri-commands.const';
import { AppInfo } from '../../models';

/** The register's own details, and the demo data loader — see `Settings`. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly zoneWrapper = inject(ZoneWrapperService);

  appInfo(): Promise<AppInfo> {
    return this.zoneWrapper.invoke<AppInfo>(TAURI_COMMANDS.appInfo);
  }

  seedDemoData(force: boolean): Promise<string> {
    return this.zoneWrapper.invoke<string>(TAURI_COMMANDS.seedDemoData, { force });
  }
}
