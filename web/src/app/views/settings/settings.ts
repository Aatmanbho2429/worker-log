import { Component, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';

import { NotifyService } from '../../core/notify.service';
import { AppInfo } from '../../models';
import { PrimengComponentsModule } from '../../shared/primeng-components-module';
import { SettingsService } from '../../services/settings/settings.service';

/**
 * Where the register lives, and the demo data loader.
 *
 * The seeder used to be a CLI subcommand on the server. There is no server and
 * no terminal in a desktop build, so it lives here instead.
 */
@Component({
  selector: 'app-settings',
  imports: [PrimengComponentsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly settingsApi = inject(SettingsService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);

  protected readonly info = signal<AppInfo | null>(null);
  protected readonly seeding = signal(false);

  constructor() {
    void this.load();
  }

  protected seed(): void {
    void this.run(false);
  }

  /**
   * Replacing existing data is destructive and irreversible, so it asks first
   * and spells out what goes.
   */
  protected reseed(): void {
    this.confirm.confirm({
      header: this.translate.instant('settings.reseedHeader'),
      message: this.translate.instant('settings.reseedMessage'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('settings.replaceEverything'),
      rejectLabel: this.translate.instant('common.cancel'),
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => void this.run(true),
    });
  }

  private async run(force: boolean): Promise<void> {
    this.seeding.set(true);
    try {
      const summary = await this.settingsApi.seedDemoData(force);
      this.notify.success(summary);
    } catch (error) {
      // A refusal because data already exists comes back as `conflict`, and
      // reads as a warning telling the operator to use Replace instead.
      this.notify.fromCommand(error, this.translate.instant('settings.seedFailed'));
    } finally {
      this.seeding.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.info.set(await this.settingsApi.appInfo());
    } catch (error) {
      this.notify.fromCommand(error, this.translate.instant('settings.infoFailed'));
    }
  }
}
